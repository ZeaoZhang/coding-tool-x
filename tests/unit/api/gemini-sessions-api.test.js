const express = require('express');
const http = require('http');

let geminiSessionsService;
let isGeminiInstalledMock;
let loadAliasesMock;

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/server/api/gemini-sessions')];
  const createRouter = require('../../../src/server/api/gemini-sessions');
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
  geminiSessionsService = {
    getProjectSessions: vi.fn(() => [{ sessionId: 'gem-1', size: 12 }]),
    getSessionById: vi.fn((sessionId) => sessionId === 'missing' ? null : {
      sessionId,
      model: 'gemini-2.0',
      messages: [
        { type: 'user', content: 'Question', timestamp: '2025-01-01T00:00:00Z' },
        { type: 'gemini', content: 'Answer', thoughts: [{ subject: 'Plan', description: 'Think first' }], timestamp: '2025-01-01T00:00:01Z' }
      ]
    }),
    searchSessions: vi.fn(() => [
      { sessionId: 'gem-1', projectHash: 'hash-a', matchCount: 2 },
      { sessionId: 'gem-2', projectHash: 'hash-b', matchCount: 1 }
    ]),
    forkSession: vi.fn(() => ({ success: true, sessionId: 'forked' })),
    deleteSession: vi.fn(() => ({ success: true })),
    getRecentSessions: vi.fn(() => [{ sessionId: 'recent-1' }]),
    saveSessionOrder: vi.fn(),
    getProjectPath: vi.fn((projectHash) => projectHash === 'missing-hash' ? null : `/workspace/${projectHash}`),
    getAllSessions: vi.fn(() => [
      { projectHash: 'hash-a', sessionId: 'old-session', startTime: '2025-01-01T00:00:00Z' },
      { projectHash: 'hash-a', sessionId: 'gem-1', startTime: '2025-01-02T00:00:00Z' },
      { projectHash: 'hash-a', sessionId: 'gem-1', startTime: '2025-01-03T00:00:00Z' }
    ])
  };
  isGeminiInstalledMock = vi.fn(() => true);
  loadAliasesMock = vi.fn(() => ({ 'gem-1': 'alias-gem' }));

  require.cache[require.resolve('../../../src/platforms/drivers/gemini/sessions-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/sessions-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/sessions-implementation'),
    loaded: true,
    exports: geminiSessionsService
  };
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/config')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/config'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/config'),
    loaded: true,
    exports: { isGeminiInstalled: isGeminiInstalledMock }
  };
  require.cache[require.resolve('../../../src/server/services/alias')] = {
    id: require.resolve('../../../src/server/services/alias'),
    filename: require.resolve('../../../src/server/services/alias'),
    loaded: true,
    exports: { loadAliases: loadAliasesMock }
  };
  require.cache[require.resolve('../../../src/server/services/session-history-index')] = {
    id: require.resolve('../../../src/server/services/session-history-index'),
    filename: require.resolve('../../../src/server/services/session-history-index'),
    loaded: true,
    exports: {
      getSessionStatus: vi.fn((source, sessionId) => {
        if (sessionId === 'missing') return Promise.resolve(null);
        return Promise.resolve({ sessionId, lastModified: Date.now(), size: 12, filePath: '/tmp/session.json' });
      }),
      getSessionOutline: vi.fn((source, sessionId) => Promise.resolve({
        sessionId,
        items: [{ userMessageNumber: 1, preview: 'Question', timestamp: Date.now() }]
      })),
      getMessagePage: vi.fn((source, sessionId, opts = {}) => {
        const limit = opts.limit || 20;
        const page = opts.page || 1;
        return Promise.resolve({
          messages: [
            { type: 'assistant', content: '**[思考过程]**\n**[思考: Plan]**\nThink first\n\n---\n\nAnswer', model: 'gemini-2.0' },
            { type: 'user', content: 'Question', userMessageNumber: 1 }
          ],
          metadata: { cwd: '/workspace/hash-a', provider: 'gemini', model: 'gemini-2.0' },
          pagination: { page, limit, total: 2, hasMore: false }
        });
      })
    }
  };
});

afterEach(() => {
  [
    '../../../src/server/api/gemini-sessions',
    '../../../src/platforms/drivers/gemini/sessions-implementation',
    '../../../src/server/services/session-history-index',
    '../../../src/platforms/drivers/gemini/config',
    '../../../src/server/services/alias'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('gemini-sessions api', () => {
  test('search and recent routes validate install state and keyword', async () => {
    const app = buildApp();
    expect((await request(app).get('/search/global')).status).toBe(400);
    expect((await request(app).get('/search/global?keyword=test')).body.totalMatches).toBe(3);
    expect((await request(app).get('/recent/list?limit=2')).body.sessions).toEqual([{ sessionId: 'recent-1' }]);
  });

  test('project sessions and messages return aliases, project info, and thought-enriched assistant content', async () => {
    const app = buildApp();
    const sessionsRes = await request(app).get('/hash-a');
    const messagesRes = await request(app).get('/hash-a/gem-1/messages?page=1&limit=5');

    expect(sessionsRes.body).toEqual(expect.objectContaining({
      totalSize: 12,
      aliases: { 'gem-1': 'alias-gem' },
      projectInfo: expect.objectContaining({
        fullPath: '/workspace/hash-a',
        displayName: 'hash-a'
      })
    }));
    expect(messagesRes.body.messages[0]).toEqual(expect.objectContaining({
      type: 'assistant',
      content: expect.stringContaining('思考过程'),
      model: 'gemini-2.0'
    }));
    expect(messagesRes.body.messages.find(item => item.type === 'user')).toEqual(expect.objectContaining({
      userMessageNumber: 1
    }));
    expect(messagesRes.body.pagination.total).toBe(2);
  });

  test('order, delete, fork, and launch behave correctly', async () => {
    const app = buildApp();
    expect((await request(app).post('/hash-a/order', { order: ['gem-1'] })).status).toBe(200);
    expect(geminiSessionsService.saveSessionOrder).toHaveBeenCalledWith('hash-a', ['gem-1']);
    expect((await request(app).delete('/hash-a/gem-1')).status).toBe(200);
    expect(geminiSessionsService.deleteSession).toHaveBeenCalledWith('gem-1');
    expect((await request(app).post('/hash-a/gem-1/fork', {
      afterUserMessageNumber: 1,
      alias: 'fork-alias'
    })).status).toBe(200);
    expect(geminiSessionsService.forkSession).toHaveBeenCalledWith('gem-1', {
      afterUserMessageNumber: 1,
      alias: 'fork-alias'
    });

    const launched = await request(app).post('/hash-a/gem-1/launch', {});
    expect(launched.status).toBe(200);
    expect(launched.body).toEqual(expect.objectContaining({
      success: true,
      projectPath: '/workspace/hash-a',
      command: 'gemini --resume 3',
      copyCommand: 'cd "/workspace/hash-a" && gemini --resume 3'
    }));
  });

  test('launch returns 404/400 for missing session or project path', async () => {
    const app = buildApp();
    expect((await request(app).post('/hash-a/missing/launch', {})).status).toBe(404);
    expect((await request(app).post('/missing-hash/gem-1/launch', {})).status).toBe(400);
  });

  test('status and outline routes expose lightweight sync data', async () => {
    const app = buildApp();

    const statusRes = await request(app).get('/hash-a/gem-1/status');
    const outlineRes = await request(app).get('/hash-a/gem-1/outline');

    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual(expect.objectContaining({
      sessionId: 'gem-1'
    }));
    expect(outlineRes.status).toBe(200);
    expect(outlineRes.body.items[0]).toEqual(expect.objectContaining({
      userMessageNumber: 1,
      preview: 'Question'
    }));
  });
});
