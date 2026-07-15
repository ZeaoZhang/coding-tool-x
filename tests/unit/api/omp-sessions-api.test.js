const express = require('express');
const http = require('http');

let ompSessionsService;
let loadAliasesMock;
let broadcastLogMock;

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/server/api/omp-sessions')];
  const createRouter = require('../../../src/server/api/omp-sessions');
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

      req.on('error', (error) => {
        server.close();
        reject(error);
      });

      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

beforeEach(() => {
  ompSessionsService = {
    buildLaunchCommand: vi.fn((sessionId, _cwd, options = {}) =>
      options.rpc ? `omp --mode rpc --session "${sessionId}"` : `omp --session "${sessionId}"`
    ),
    getProjects: vi.fn(() => [{ name: 'repo-omp', fullPath: '/workspace/repo-omp', displayName: 'Repo OMP' }]),
    getSessionsByProject: vi.fn(() => [{ sessionId: 'omp-1', size: 42 }]),
    getSessionById: vi.fn((sessionId) => sessionId === 'missing' ? null : {
      sessionId,
      directory: '/workspace/repo-omp',
      filePath: `/tmp/${sessionId}.jsonl`,
      model: 'omp-model',
      provider: 'omp-provider'
    }),
    getSessionMessages: vi.fn(() => [
      { type: 'user', role: 'user', content: 'Question' },
      { type: 'assistant', role: 'assistant', content: 'Answer' }
    ]),
    getRecentSessions: vi.fn(() => [{ sessionId: 'recent-1' }]),
    searchSessions: vi.fn(() => [{ sessionId: 'omp-1', matchCount: 2 }]),
    deleteSession: vi.fn(() => ({ success: true })),
    forkSession: vi.fn(() => ({ success: true, newSessionId: 'forked' })),
    saveSessionOrder: vi.fn(),
    isOmpInstalled: vi.fn(() => true),
    HOME_DIR: '/home/tester'
  };
  loadAliasesMock = vi.fn(() => ({ 'omp-1': 'omp-alias' }));
  broadcastLogMock = vi.fn();

  require.cache[require.resolve('../../../src/server/services/omp-sessions')] = {
    id: require.resolve('../../../src/server/services/omp-sessions'),
    filename: require.resolve('../../../src/server/services/omp-sessions'),
    loaded: true,
    exports: ompSessionsService
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
});

afterEach(() => {
  [
    '../../../src/server/api/omp-sessions',
    '../../../src/server/services/omp-sessions',
    '../../../src/server/services/alias',
    '../../../src/server/websocket-server'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('omp-sessions api', () => {
  test('global and project search validate keyword and return source metadata', async () => {
    const app = buildApp();
    expect((await request(app).get('/search/global')).status).toBe(400);
    expect((await request(app).get('/search/global?keyword=test')).body.source).toBe('omp');
    expect((await request(app).get('/repo-omp/search?keyword=test')).body.totalMatches).toBe(2);
  });

  test('project sessions and message pagination include aliases and project metadata', async () => {
    const app = buildApp();
    const sessionsRes = await request(app).get('/repo-omp');
    const messagesRes = await request(app).get('/repo-omp/omp-1/messages?page=1&limit=2&order=desc');

    expect(sessionsRes.body).toEqual(expect.objectContaining({
      totalSize: 42,
      aliases: { 'omp-1': 'omp-alias' },
      projectInfo: expect.objectContaining({
        fullPath: '/workspace/repo-omp',
        displayName: 'Repo OMP'
      })
    }));
    expect(messagesRes.body.metadata).toEqual(expect.objectContaining({
      cwd: '/workspace/repo-omp',
      provider: 'omp-provider',
      model: 'omp-model'
    }));
    expect(messagesRes.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 2,
      hasMore: false
    });
    expect(messagesRes.body.messages[0]).toEqual({ type: 'assistant', role: 'assistant', content: 'Answer' });
    expect(messagesRes.body.messages.find(item => item.type === 'user')).toEqual(expect.objectContaining({
      userMessageNumber: 1
    }));
  });

  test('recent, order, delete, fork, batch delete, and launch routes delegate correctly', async () => {
    const app = buildApp();
    expect((await request(app).get('/recent/list?limit=2')).body.source).toBe('omp');
    expect(ompSessionsService.getRecentSessions).toHaveBeenCalledWith(2);
    expect((await request(app).post('/repo-omp/order', { order: ['omp-1'] })).status).toBe(200);
    expect(ompSessionsService.saveSessionOrder).toHaveBeenCalledWith('repo-omp', ['omp-1']);
    expect((await request(app).delete('/repo-omp/omp-1')).status).toBe(200);
    expect((await request(app).post('/repo-omp/omp-1/fork', { afterMessageId: 'm1' })).status).toBe(200);
    expect(ompSessionsService.forkSession).toHaveBeenCalledWith('omp-1', { afterMessageId: 'm1' });
    expect((await request(app).post('/repo-omp/batch-delete', { sessionIds: ['omp-1', 'omp-1', 'omp-2'] })).body).toEqual(expect.objectContaining({
      success: true,
      requestedCount: 2,
      deletedCount: 2
    }));

    const launched = await request(app).post('/repo-omp/omp-1/launch', { rpc: true });
    expect(launched.status).toBe(200);
    expect(launched.body).toEqual(expect.objectContaining({
      success: true,
      cwd: '/workspace/repo-omp',
      command: 'omp --mode rpc --session "omp-1"',
      copyCommand: 'cd "/workspace/repo-omp" && omp --mode rpc --session "omp-1"'
    }));
    expect(broadcastLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'launch_pi_session',
      toolType: 'omp',
      source: 'omp'
    }));
  });

  test('status, outline, and not found routes expose expected responses', async () => {
    const app = buildApp();

    expect((await request(app).get('/repo-omp/omp-1/status')).body).toEqual(expect.objectContaining({
      sessionId: 'omp-1'
    }));
    expect((await request(app).get('/repo-omp/omp-1/outline')).body.items[0]).toEqual(expect.objectContaining({
      userMessageNumber: 1,
      preview: 'Question'
    }));
    expect((await request(app).post('/repo-omp/batch-delete', { sessionIds: [] })).status).toBe(400);
    expect((await request(app).post('/repo-omp/missing/launch', {})).status).toBe(404);

    ompSessionsService.deleteSession.mockImplementationOnce(() => {
      throw new Error('Session not found');
    });
    ompSessionsService.forkSession.mockImplementationOnce(() => {
      throw new Error('Session not found');
    });
    expect((await request(app).delete('/repo-omp/omp-1')).status).toBe(404);
    expect((await request(app).post('/repo-omp/omp-1/fork', {})).status).toBe(404);
  });

  test('returns 404 for installed-gated routes when OMP is unavailable', async () => {
    ompSessionsService.isOmpInstalled.mockReturnValue(false);
    const res = await request(buildApp()).get('/recent/list');
    expect(res.status).toBe(404);
  });
});
