const express = require('express');
const http = require('http');

let piSessionsService;
let loadAliasesMock;
let broadcastLogMock;

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/server/api/pi-sessions')];
  const createRouter = require('../../../src/server/api/pi-sessions');
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
  piSessionsService = {
    buildLaunchCommand: vi.fn((sessionId, _cwd, options = {}) =>
      options.rpc ? `pi --mode rpc --session "${sessionId}"` : `pi --session "${sessionId}"`
    ),
    getProjects: vi.fn(() => [{ name: 'repo-pi', fullPath: '/workspace/repo-pi', displayName: 'Repo Pi' }]),
    getSessionsByProject: vi.fn(() => [{ sessionId: 'pi-1', size: 42 }]),
    getSessionById: vi.fn((sessionId) => sessionId === 'missing' ? null : {
      sessionId,
      directory: '/workspace/repo-pi',
      filePath: `/tmp/${sessionId}.jsonl`,
      model: 'pi-model',
      provider: 'pi-provider'
    }),
    getSessionMessages: vi.fn(() => [
      { type: 'user', role: 'user', content: 'Question' },
      { type: 'assistant', role: 'assistant', content: 'Answer' }
    ]),
    getRecentSessions: vi.fn(() => [{ sessionId: 'recent-1' }]),
    searchSessions: vi.fn(() => [{ sessionId: 'pi-1', matchCount: 2 }]),
    deleteSession: vi.fn(() => ({ success: true })),
    forkSession: vi.fn(() => ({ success: true, newSessionId: 'forked' })),
    saveSessionOrder: vi.fn(),
    isPiInstalled: vi.fn(() => true),
    HOME_DIR: '/home/tester'
  };
  loadAliasesMock = vi.fn(() => ({ 'pi-1': 'pi-alias' }));
  broadcastLogMock = vi.fn();

  require.cache[require.resolve('../../../src/server/services/pi-sessions')] = {
    id: require.resolve('../../../src/server/services/pi-sessions'),
    filename: require.resolve('../../../src/server/services/pi-sessions'),
    loaded: true,
    exports: piSessionsService
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
    '../../../src/server/api/pi-sessions',
    '../../../src/server/services/pi-sessions',
    '../../../src/server/services/alias',
    '../../../src/server/websocket-server'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('pi-sessions api', () => {
  test('global and project search validate keyword and return source metadata', async () => {
    const app = buildApp();
    expect((await request(app).get('/search/global')).status).toBe(400);
    expect((await request(app).get('/search/global?keyword=test')).body.source).toBe('pi');
    expect((await request(app).get('/repo-pi/search?keyword=test')).body.totalMatches).toBe(2);
  });

  test('project sessions and message pagination include aliases and project metadata', async () => {
    const app = buildApp();
    const sessionsRes = await request(app).get('/repo-pi');
    const messagesRes = await request(app).get('/repo-pi/pi-1/messages?page=1&limit=2&order=desc');

    expect(sessionsRes.body).toEqual(expect.objectContaining({
      totalSize: 42,
      aliases: { 'pi-1': 'pi-alias' },
      projectInfo: expect.objectContaining({
        fullPath: '/workspace/repo-pi',
        displayName: 'Repo Pi'
      })
    }));
    expect(messagesRes.body.metadata).toEqual(expect.objectContaining({
      cwd: '/workspace/repo-pi',
      provider: 'pi-provider',
      model: 'pi-model'
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
    expect((await request(app).get('/recent/list?limit=2')).body.source).toBe('pi');
    expect(piSessionsService.getRecentSessions).toHaveBeenCalledWith(2);
    expect((await request(app).post('/repo-pi/order', { order: ['pi-1'] })).status).toBe(200);
    expect(piSessionsService.saveSessionOrder).toHaveBeenCalledWith('repo-pi', ['pi-1']);
    expect((await request(app).delete('/repo-pi/pi-1')).status).toBe(200);
    expect((await request(app).post('/repo-pi/pi-1/fork', { afterMessageId: 'm1' })).status).toBe(200);
    expect(piSessionsService.forkSession).toHaveBeenCalledWith('pi-1', { afterMessageId: 'm1' });
    expect((await request(app).post('/repo-pi/batch-delete', { sessionIds: ['pi-1', 'pi-1', 'pi-2'] })).body).toEqual(expect.objectContaining({
      success: true,
      requestedCount: 2,
      deletedCount: 2
    }));

    const launched = await request(app).post('/repo-pi/pi-1/launch', { rpc: true });
    expect(launched.status).toBe(200);
    expect(launched.body).toEqual(expect.objectContaining({
      success: true,
      cwd: '/workspace/repo-pi',
      command: 'pi --mode rpc --session "pi-1"',
      copyCommand: 'cd "/workspace/repo-pi" && pi --mode rpc --session "pi-1"'
    }));
    expect(broadcastLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'launch_pi_session',
      toolType: 'pi',
      source: 'pi'
    }));
  });

  test('status, outline, and not found routes expose expected responses', async () => {
    const app = buildApp();

    expect((await request(app).get('/repo-pi/pi-1/status')).body).toEqual(expect.objectContaining({
      sessionId: 'pi-1'
    }));
    expect((await request(app).get('/repo-pi/pi-1/outline')).body.items[0]).toEqual(expect.objectContaining({
      userMessageNumber: 1,
      preview: 'Question'
    }));
    expect((await request(app).post('/repo-pi/batch-delete', { sessionIds: [] })).status).toBe(400);
    expect((await request(app).post('/repo-pi/missing/launch', {})).status).toBe(404);

    piSessionsService.deleteSession.mockImplementationOnce(() => {
      throw new Error('Session not found');
    });
    piSessionsService.forkSession.mockImplementationOnce(() => {
      throw new Error('Session not found');
    });
    expect((await request(app).delete('/repo-pi/pi-1')).status).toBe(404);
    expect((await request(app).post('/repo-pi/pi-1/fork', {})).status).toBe(404);
  });

  test('returns 404 for installed-gated routes when Pi is unavailable', async () => {
    piSessionsService.isPiInstalled.mockReturnValue(false);
    const res = await request(buildApp()).get('/recent/list');
    expect(res.status).toBe(404);
  });
});
