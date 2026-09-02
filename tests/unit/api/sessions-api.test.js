const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let testDir;
let nativePaths;
let sessionsService;
let aliasService;
let broadcastLogMock;
let randomUuidSpy;

function buildApp(config = { feature: 'test' }) {
  delete require.cache[require.resolve('../../../src/server/api/sessions')];
  const createRouter = require('../../../src/server/api/sessions');
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
      const port = server.address().port;
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
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
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: res.headers });
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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-api-'));
  nativePaths = {
    claude: {
      projects: path.join(testDir, 'claude-projects')
    },
    codex: {
      sessions: path.join(testDir, 'codex-sessions')
    },
    gemini: {
      tmp: path.join(testDir, 'gemini-tmp')
    }
  };

  sessionsService = {
    getSessionsForProject: vi.fn(async () => ({
      sessions: [{ id: 'session-1', title: 'Demo Session' }],
      totalSize: 1024
    })),
    deleteSession: vi.fn(() => ({ success: true })),
    forkSession: vi.fn(() => ({ success: true, sessionId: 'forked-session' })),
    saveSessionOrder: vi.fn(),
    parseRealProjectPath: vi.fn((projectName) => ({
      fullPath: path.join(testDir, 'projects', projectName),
      projectName: `display:${projectName}`
    })),
    searchSessions: vi.fn(() => [{ id: 'session-1', matchCount: 2 }]),
    getRecentSessions: vi.fn(async () => [{ id: 'recent-1' }]),
    searchSessionsAcrossProjects: vi.fn(async () => [{ id: 'global-1', matchCount: 3 }]),
    hasActualMessages: vi.fn(() => true)
  };

  aliasService = {
    loadAliases: vi.fn(() => ({
      'session-1234': 'my-session'
    }))
  };

  broadcastLogMock = vi.fn();

  const sessionsPath = require.resolve('../../../src/platforms/drivers/claude/sessions-implementation');
  require.cache[sessionsPath] = {
    id: sessionsPath,
    filename: sessionsPath,
    loaded: true,
    exports: sessionsService
  };

  const aliasPath = require.resolve('../../../src/server/services/alias');
  require.cache[aliasPath] = {
    id: aliasPath,
    filename: aliasPath,
    loaded: true,
    exports: aliasService
  };

  const wsPath = require.resolve('../../../src/server/websocket-server');
  require.cache[wsPath] = {
    id: wsPath,
    filename: wsPath,
    loaded: true,
    exports: {
      broadcastLog: broadcastLogMock
    }
  };

  const configPaths = require.resolve('../../../src/config/paths');
  require.cache[configPaths] = {
    id: configPaths,
    filename: configPaths,
    loaded: true,
    exports: {
      NATIVE_PATHS: nativePaths
    }
  };

  randomUuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('session-1234');
});

afterEach(() => {
  randomUuidSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/api/sessions',
    '../../../src/platforms/drivers/claude/sessions-implementation',
    '../../../src/server/services/alias',
    '../../../src/server/websocket-server',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('sessions api listing and search', () => {
  test('lists sessions for a project and includes parsed project info', async () => {
    const res = await request(buildApp()).get('/demo-project');

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.projectInfo).toEqual({
      name: 'demo-project',
      displayName: 'display:demo-project',
      fullPath: path.join(testDir, 'projects', 'demo-project')
    });
    expect(aliasService.loadAliases).toHaveBeenCalled();
  });

  test('validates missing global search keyword and returns recent sessions', async () => {
    const app = buildApp();

    const missingKeyword = await request(app).get('/search/global');
    const recent = await request(app).get('/recent/list?limit=3');

    expect(missingKeyword.status).toBe(400);
    expect(recent.status).toBe(200);
    expect(sessionsService.getRecentSessions).toHaveBeenCalledWith({ feature: 'test' }, 3);
  });
});

describe('sessions api create and mutate routes', () => {
  test('creates claude sessions in project .claude/sessions and broadcasts action log', async () => {
    const projectPath = path.join(testDir, 'projects', 'demo-project');
    fs.mkdirSync(projectPath, { recursive: true });

    const res = await request(buildApp()).post('/demo-project/create', {
      toolType: 'claude'
    });

    const sessionFile = path.join(projectPath, '.claude', 'sessions', 'session-1234.jsonl');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      sessionId: 'session-1234',
      toolType: 'claude',
      sessionFile
    }));
    expect(fs.readFileSync(sessionFile, 'utf8')).toContain('"type":"metadata"');
    expect(broadcastLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create_session',
      sessionId: 'session-1234',
      tool: 'claude'
    }));
  });

  test('creates gemini sessions under hashed tmp chats directory and rejects invalid tool types', async () => {
    const projectPath = path.join(testDir, 'projects', 'demo-project');
    fs.mkdirSync(projectPath, { recursive: true });

    const validRes = await request(buildApp()).post('/demo-project/create', {
      toolType: 'gemini'
    });
    const pathHash = crypto.createHash('sha256').update(projectPath).digest('hex');
    const sessionFile = path.join(nativePaths.gemini.tmp, pathHash, 'chats', 'session-1234.json');

    expect(validRes.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(sessionFile, 'utf8'))).toEqual(expect.objectContaining({
      id: 'session-1234',
      projectPath,
      messages: []
    }));

    const invalidRes = await request(buildApp()).post('/demo-project/create', {
      toolType: 'unknown'
    });
    expect(invalidRes.status).toBe(400);
  });

  test('saves custom session order and proxies delete and fork operations', async () => {
    const app = buildApp();

    const orderRes = await request(app).post('/demo-project/order', {
      order: ['b', 'a']
    });
    const deleteRes = await request(app).delete('/demo-project/session-1');
    const forkRes = await request(app).post('/demo-project/session-1/fork', {
      afterUserMessageNumber: 2,
      alias: 'fork-alias'
    });

    expect(orderRes.status).toBe(200);
    expect(sessionsService.saveSessionOrder).toHaveBeenCalledWith('demo-project', ['b', 'a']);
    expect(deleteRes.status).toBe(200);
    expect(sessionsService.deleteSession).toHaveBeenCalledWith({ feature: 'test' }, 'demo-project', 'session-1');
    expect(forkRes.status).toBe(200);
    expect(sessionsService.forkSession).toHaveBeenCalledWith({ feature: 'test' }, 'demo-project', 'session-1', {
      afterUserMessageNumber: 2,
      alias: 'fork-alias'
    });
  });
});

describe('sessions api messages and launch routes', () => {
  test('returns 404 for missing session files and for sessions without actual messages', async () => {
    const app = buildApp();
    const missing = await request(app).get('/demo-project/missing/messages');

    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain('Session file not found');

    const projectPath = path.join(testDir, 'projects', 'demo-project');
    const sessionsDir = path.join(projectPath, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'empty-session.jsonl'), '{}\n', 'utf8');
    sessionsService.hasActualMessages.mockReturnValue(false);

    const noMessages = await request(buildApp()).get('/demo-project/empty-session/messages');

    expect(noMessages.status).toBe(404);
    expect(noMessages.body.reason).toContain('file history snapshots');
  });

  test('parses paginated messages and deferred tool results from session JSONL', async () => {
    const projectPath = path.join(testDir, 'projects', 'demo-project');
    const sessionsDir = path.join(projectPath, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'session-1.jsonl'),
      [
        JSON.stringify({ type: 'summary', summary: 'Session summary', cwd: projectPath, gitBranch: 'main' }),
        JSON.stringify({
          type: 'assistant',
          message: {
            id: 'assistant-1',
            model: 'claude-3',
            content: [
              { type: 'text', text: 'Answer text' },
              { type: 'tool_use', name: 'search', input: { q: 'docs' } }
            ]
          },
          timestamp: '2025-01-01T00:00:01.000Z'
        }),
        JSON.stringify({
          type: 'user',
          message: {
            id: 'user-1',
            content: [
              { type: 'text', text: 'Question text' },
              { type: 'tool_result', content: 'search result' }
            ]
          },
          timestamp: '2025-01-01T00:00:02.000Z'
        })
      ].join('\n') + '\n',
      'utf8'
    );

    const res = await request(buildApp()).get('/demo-project/session-1/messages?page=1&limit=2&order=desc');

    expect(res.status).toBe(200);
    expect(res.body.metadata).toEqual(expect.objectContaining({
      summary: 'Session summary',
      gitBranch: 'main',
      cwd: projectPath
    }));
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      hasMore: true
    });
    expect(res.body.messages[0]).toEqual(expect.objectContaining({
      type: 'assistant',
      subtype: 'tool_result',
      content: expect.stringContaining('search result'),
      messageId: 'user-1-tool-result'
    }));
    expect(res.body.messages[1]).toEqual(expect.objectContaining({
      type: 'user',
      content: 'Question text',
      userMessageNumber: 1
    }));
  });

  test('returns lightweight session status and outline data', async () => {
    const projectPath = path.join(testDir, 'projects', 'demo-project');
    const sessionsDir = path.join(projectPath, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'session-1.jsonl'),
      [
        JSON.stringify({ type: 'summary', summary: 'Session summary' }),
        JSON.stringify({ type: 'user', message: { content: 'First question' }, timestamp: '2025-01-01T00:00:00.000Z' }),
        JSON.stringify({ type: 'assistant', message: { content: 'First answer' }, timestamp: '2025-01-01T00:00:01.000Z' }),
        JSON.stringify({ type: 'user', message: { content: 'Second question' }, timestamp: '2025-01-01T00:00:02.000Z' })
      ].join('\n') + '\n',
      'utf8'
    );

    const app = buildApp();
    const statusRes = await request(app).get('/demo-project/session-1/status');
    const outlineRes = await request(app).get('/demo-project/session-1/outline');

    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      size: expect.any(Number)
    }));
    expect(outlineRes.status).toBe(200);
    expect(outlineRes.body.items).toEqual([
      expect.objectContaining({ userMessageNumber: 1, preview: 'First question' }),
      expect.objectContaining({ userMessageNumber: 2, preview: 'Second question' })
    ]);
  });

  test('launch route copies global sessions into project directory and returns copy command', async () => {
    const projectPath = path.join(testDir, 'projects', 'demo-project');
    const globalProjectDir = path.join(nativePaths.claude.projects, 'demo-project');
    const globalSessionFile = path.join(globalProjectDir, 'session-1234.jsonl');
    fs.mkdirSync(globalProjectDir, { recursive: true });
    fs.writeFileSync(globalSessionFile, `${JSON.stringify({ cwd: projectPath })}\n`, 'utf8');

    const res = await request(buildApp()).post('/demo-project/session-1234/launch', {});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      cwd: projectPath,
      sessionId: 'session-1234',
      tool: 'claude',
      command: 'claude -r session-1234',
      copyCommand: `cd "${projectPath}" && claude -r session-1234`
    }));
    expect(fs.existsSync(path.join(projectPath, '.claude', 'sessions', 'session-1234.jsonl'))).toBe(true);
    expect(broadcastLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'launch_session',
      alias: 'my-session'
    }));
  });
});
