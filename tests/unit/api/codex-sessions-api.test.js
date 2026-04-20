const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let codexSessionsService;
let loadAliasesMock;
let isCodexInstalledMock;
let broadcastLogMock;

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/server/api/codex-sessions')];
  const createRouter = require('../../../src/server/api/codex-sessions');
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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sessions-api-'));
  const sessionFile = path.join(testDir, 'session.jsonl');
  fs.writeFileSync(sessionFile, `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/workspace/codex-project' } })}\n`, 'utf8');

  codexSessionsService = {
    getSessionsByProject: vi.fn(() => [{ sessionId: 'sess-1', size: 128 }]),
    getSessionById: vi.fn((sessionId) => {
      if (sessionId === 'missing') return null;
      return {
        sessionId,
        provider: 'codex',
        gitBranch: 'main',
        gitRepository: 'repo',
        cwd: '/workspace/codex-project',
        filePath: sessionFile,
        messages: [
          { role: 'user', content: 'Hello', timestamp: '2025-01-01T00:00:00Z' },
          { role: 'assistant', content: 'World', model: 'gpt-5', timestamp: '2025-01-01T00:00:01Z' },
          { role: 'reasoning', content: 'Think', timestamp: '2025-01-01T00:00:02Z' },
          { role: 'tool_call', name: 'search', arguments: { q: 'docs' }, timestamp: '2025-01-01T00:00:03Z' },
          { role: 'tool_output', output: { output: 'done', metadata: { exit_code: 0, duration_seconds: 1 } }, timestamp: '2025-01-01T00:00:04Z' }
        ]
      };
    }),
    searchSessions: vi.fn(() => [
      { sessionId: 'sess-1', projectName: 'repo-a', messageIndex: 1, role: 'assistant', context: 'ctx', timestamp: '2025-01-01' },
      { sessionId: 'sess-1', projectName: 'repo-a', messageIndex: 2, role: 'user', context: 'ctx2', timestamp: '2025-01-02' },
      { sessionId: 'sess-2', projectName: 'repo-b', messageIndex: 1, role: 'user', context: 'ctx3', timestamp: '2025-01-03' }
    ]),
    forkSession: vi.fn(() => ({ success: true, sessionId: 'forked' })),
    deleteSession: vi.fn(() => ({ success: true })),
    getRecentSessions: vi.fn(() => [{ sessionId: 'recent-1' }]),
    saveSessionOrder: vi.fn()
  };
  loadAliasesMock = vi.fn(() => ({ 'sess-1': 'alpha' }));
  isCodexInstalledMock = vi.fn(() => true);
  broadcastLogMock = vi.fn();

  require.cache[require.resolve('../../../src/server/services/codex-sessions')] = {
    id: require.resolve('../../../src/server/services/codex-sessions'),
    filename: require.resolve('../../../src/server/services/codex-sessions'),
    loaded: true,
    exports: codexSessionsService
  };
  require.cache[require.resolve('../../../src/server/services/codex-config')] = {
    id: require.resolve('../../../src/server/services/codex-config'),
    filename: require.resolve('../../../src/server/services/codex-config'),
    loaded: true,
    exports: { isCodexInstalled: isCodexInstalledMock }
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
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/api/codex-sessions',
    '../../../src/server/services/codex-sessions',
    '../../../src/server/services/codex-config',
    '../../../src/server/services/alias',
    '../../../src/server/websocket-server'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('codex-sessions api', () => {
  test('global search validates keyword and groups matches by session', async () => {
    const app = buildApp();

    const invalid = await request(app).get('/search/global');
    const ok = await request(app).get('/search/global?keyword=hello');

    expect(invalid.status).toBe(400);
    expect(ok.status).toBe(200);
    expect(ok.body.totalMatches).toBe(3);
    expect(ok.body.sessions[0]).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      matchCount: 2
    }));
  });

  test('project listing and message conversion include aliases, metadata, pagination, and user anchors', async () => {
    const app = buildApp();

    const sessionsRes = await request(app).get('/repo-a');
    const messagesRes = await request(app).get('/repo-a/sess-1/messages?page=1&limit=3&order=desc');

    expect(sessionsRes.status).toBe(200);
    expect(sessionsRes.body).toEqual(expect.objectContaining({
      totalSize: 128,
      aliases: { 'sess-1': 'alpha' }
    }));
    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.pagination).toEqual({
      page: 1,
      limit: 3,
      total: 5,
      hasMore: true
    });
    expect(messagesRes.body.messages[0]).toEqual(expect.objectContaining({
      subtype: 'tool_result',
      content: expect.stringContaining('done')
    }));
    expect(messagesRes.body.messages[1].content).toContain('调用工具');
    expect(messagesRes.body.messages.find(item => item.type === 'user')).toEqual(expect.objectContaining({
      userMessageNumber: 1
    }));
    expect(messagesRes.body.metadata).toEqual({
      gitBranch: 'main',
      gitRepository: 'repo',
      cwd: '/workspace/codex-project',
      provider: 'codex'
    });
  });

  test('recent, order, delete, fork, and launch routes delegate correctly', async () => {
    const app = buildApp();

    const recent = await request(app).get('/recent/list?limit=2');
    const ordered = await request(app).post('/repo-a/order', { order: ['sess-2', 'sess-1'] });
    const deleted = await request(app).delete('/repo-a/sess-1');
    const forked = await request(app).post('/repo-a/sess-1/fork', {
      afterUserMessageNumber: 1,
      alias: 'fork-alias'
    });
    const launched = await request(app).post('/repo-a/sess-1/launch', {});

    expect(recent.status).toBe(200);
    expect(codexSessionsService.getRecentSessions).toHaveBeenCalledWith(2);
    expect(ordered.status).toBe(200);
    expect(codexSessionsService.saveSessionOrder).toHaveBeenCalledWith('repo-a', ['sess-2', 'sess-1']);
    expect(deleted.status).toBe(200);
    expect(codexSessionsService.deleteSession).toHaveBeenCalledWith('sess-1');
    expect(forked.status).toBe(200);
    expect(codexSessionsService.forkSession).toHaveBeenCalledWith('sess-1', {
      afterUserMessageNumber: 1,
      alias: 'fork-alias'
    });
    expect(launched.status).toBe(200);
    expect(launched.body).toEqual(expect.objectContaining({
      success: true,
      cwd: '/workspace/codex-project',
      command: 'codex resume sess-1',
      copyCommand: 'cd "/workspace/codex-project" && codex resume sess-1'
    }));
    expect(broadcastLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'launch_codex_session',
      alias: 'alpha'
    }));
  });

  test('launch returns 404 for missing session and 400 when cwd cannot be resolved', async () => {
    const app = buildApp();
    codexSessionsService.getSessionById.mockImplementationOnce(() => null);
    const missing = await request(app).post('/repo-a/missing/launch', {});

    codexSessionsService.getSessionById.mockImplementationOnce(() => ({
      sessionId: 'sess-2',
      filePath: path.join(testDir, 'invalid.jsonl'),
      messages: []
    }));
    fs.writeFileSync(path.join(testDir, 'invalid.jsonl'), '{}\n', 'utf8');
    const invalid = await request(app).post('/repo-a/sess-2/launch', {});

    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
  });

  test('status and outline routes expose lightweight sync data', async () => {
    const app = buildApp();

    const statusRes = await request(app).get('/repo-a/sess-1/status');
    const outlineRes = await request(app).get('/repo-a/sess-1/outline');

    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      size: expect.any(Number)
    }));
    expect(outlineRes.status).toBe(200);
    expect(outlineRes.body.items[0]).toEqual(expect.objectContaining({
      userMessageNumber: 1,
      preview: 'Hello'
    }));
  });
});
