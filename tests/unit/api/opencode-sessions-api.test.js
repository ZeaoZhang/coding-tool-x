const express = require('express');
const http = require('http');

let opencodeSessionsService;
let loadAliasesMock;
let broadcastLogMock;

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/platforms/drivers/opencode/api-sessions')];
  const createRouter = require('../../../src/platforms/drivers/opencode/api-sessions');
  const app = express();
  app.use(express.json());
  app.use('/', createRouter(config));
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); },
    delete(url) { return call(app, 'DELETE', url); }
  };
}

function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers: rawBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody)
        } : {}
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', reject);
      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

beforeEach(() => {
  opencodeSessionsService = {
    getProjects: vi.fn(() => [{ name: 'repo-open', fullPath: '/workspace/repo-open', displayName: 'Repo Open' }]),
    getSessionsByProject: vi.fn(() => [{ sessionId: 'open-1', size: 42 }]),
    getSessionById: vi.fn((sessionId) => sessionId === 'missing' ? null : { sessionId, directory: '/workspace/repo-open' }),
    getSessionMessages: vi.fn(() => [
      { type: 'user', content: 'Question' },
      { type: 'assistant', content: 'Answer' }
    ]),
    getRecentSessions: vi.fn(() => [{ sessionId: 'recent-1' }]),
    searchSessions: vi.fn(() => [{ sessionId: 'open-1', matchCount: 2 }]),
    deleteSession: vi.fn(() => ({ success: true })),
    forkSession: vi.fn(() => ({ success: true, sessionId: 'forked' })),
    saveSessionOrder: vi.fn(),
    isOpenCodeInstalled: vi.fn(() => true)
  };
  loadAliasesMock = vi.fn(() => ({ 'open-1': 'open-alias' }));
  broadcastLogMock = vi.fn();

  require.cache[require.resolve('../../../src/platforms/drivers/opencode/sessions-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/sessions-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/sessions-implementation'),
    loaded: true,
    exports: opencodeSessionsService
  };
  require.cache[require.resolve('../../../src/server/services/alias')] = {
    id: require.resolve('../../../src/server/services/alias'),
    filename: require.resolve('../../../src/server/services/alias'),
    loaded: true,
    exports: { loadAliases: loadAliasesMock }
  };
  require.cache[require.resolve('../../../src/server/websocket-server')] = {
    id: require.resolve('../../../src/server/websocket-server'),
    filename: require.resolve('../../../src/server/websocket-server'),
    loaded: true,
    exports: { broadcastLog: broadcastLogMock }
  };
  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: { HOME_DIR: '/home/tester' }
  };
});

afterEach(() => {
  [
    '../../../src/platforms/drivers/opencode/api-sessions',
    '../../../src/platforms/drivers/opencode/sessions-implementation',
    '../../../src/server/services/alias',
    '../../../src/server/websocket-server',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('opencode-sessions api', () => {
  test('global and project search validate keyword and return source metadata', async () => {
    const app = buildApp();
    expect((await request(app).get('/search/global')).status).toBe(400);
    expect((await request(app).get('/search/global?keyword=test')).body.source).toBe('opencode');
    expect((await request(app).get('/repo-open/search?keyword=test')).body.totalMatches).toBe(2);
  });

  test('project sessions and message pagination include aliases and project metadata', async () => {
    const app = buildApp();
    const sessionsRes = await request(app).get('/repo-open');
    const messagesRes = await request(app).get('/repo-open/open-1/messages?page=1&limit=2&order=desc');

    expect(sessionsRes.body).toEqual(expect.objectContaining({
      totalSize: 42,
      aliases: { 'open-1': 'open-alias' },
      projectInfo: expect.objectContaining({
        fullPath: '/workspace/repo-open',
        displayName: 'Repo Open'
      })
    }));
    expect(messagesRes.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 2,
      hasMore: false
    });
    expect(messagesRes.body.messages[0]).toEqual({ type: 'assistant', content: 'Answer' });
    expect(messagesRes.body.messages.find(item => item.type === 'user')).toEqual(expect.objectContaining({
      userMessageNumber: 1
    }));
  });

  test('recent, order, delete, fork, and launch routes delegate correctly', async () => {
    const app = buildApp();
    expect((await request(app).get('/recent/list?limit=2')).body.source).toBe('opencode');
    expect((await request(app).post('/repo-open/order', { order: ['open-1'] })).status).toBe(200);
    expect(opencodeSessionsService.saveSessionOrder).toHaveBeenCalledWith('repo-open', ['open-1']);
    expect((await request(app).delete('/repo-open/open-1')).status).toBe(200);
    expect((await request(app).post('/repo-open/open-1/fork', {})).status).toBe(200);

    const launched = await request(app).post('/repo-open/open-1/launch', {});
    expect(launched.status).toBe(200);
    expect(launched.body).toEqual(expect.objectContaining({
      success: true,
      cwd: '/workspace/repo-open',
      command: 'opencode -r open-1',
      copyCommand: 'cd "/workspace/repo-open" && opencode -r open-1'
    }));
    expect(broadcastLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'launch_opencode_session'
    }));
  });

  test('delete and fork return 404 when session is not found', async () => {
    opencodeSessionsService.deleteSession.mockImplementationOnce(() => {
      throw new Error('Session not found');
    });
    opencodeSessionsService.forkSession.mockImplementationOnce(() => {
      throw new Error('Session not found');
    });
    const app = buildApp();

    expect((await request(app).delete('/repo-open/open-1')).status).toBe(404);
    expect((await request(app).post('/repo-open/open-1/fork', {})).status).toBe(404);
    expect((await request(app).post('/repo-open/missing/launch', {})).status).toBe(404);
  });

  test('status and outline routes expose lightweight sync data', async () => {
    const app = buildApp();

    const statusRes = await request(app).get('/repo-open/open-1/status');
    const outlineRes = await request(app).get('/repo-open/open-1/outline');

    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual(expect.objectContaining({
      sessionId: 'open-1'
    }));
    expect(outlineRes.status).toBe(200);
    expect(outlineRes.body.items[0]).toEqual(expect.objectContaining({
      userMessageNumber: 1,
      preview: 'Question'
    }));
  });
});
