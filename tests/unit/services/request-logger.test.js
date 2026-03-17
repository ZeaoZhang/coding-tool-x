const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let requestLogger;
let envBackup;
let pathsStub;

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'request-logger-'));
  envBackup = {
    CC_TOOL_LOG_REQUESTS: process.env.CC_TOOL_LOG_REQUESTS,
    CC_TOOL_LOG_API_REQUESTS: process.env.CC_TOOL_LOG_API_REQUESTS
  };
  delete process.env.CC_TOOL_LOG_REQUESTS;
  delete process.env.CC_TOOL_LOG_API_REQUESTS;

  pathsStub = {
    PATHS: {
      requestSnapshots: {
        claude: path.join(testDir, 'snapshots', 'claude.jsonl'),
        codex: path.join(testDir, 'snapshots', 'codex.jsonl'),
        gemini: path.join(testDir, 'snapshots', 'gemini.jsonl'),
        opencode: path.join(testDir, 'snapshots', 'opencode.jsonl')
      },
      logs: path.join(testDir, 'logs'),
      claudeRequestTemplate: path.join(testDir, 'state', 'claude-request-template.json')
    }
  };

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: pathsStub
  };

  vi.spyOn(fs, 'appendFile').mockImplementation((filePath, data, callback) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, data);
    if (typeof callback === 'function') callback(null);
  });

  vi.spyOn(fs, 'writeFile').mockImplementation((filePath, data, callback) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data, 'utf8');
    if (typeof callback === 'function') callback(null);
  });

  delete require.cache[require.resolve('../../../src/server/services/request-logger')];
  requestLogger = require('../../../src/server/services/request-logger');
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.entries(envBackup).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/request-logger',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('request-logger toggles and persistence', () => {
  test('persists proxy request snapshots only when logging is enabled', () => {
    requestLogger.persistProxyRequestSnapshot('claude', { requestId: 'disabled' });
    expect(fs.existsSync(pathsStub.PATHS.requestSnapshots.claude)).toBe(false);
    expect(requestLogger.isProxyRequestLoggingEnabled()).toBe(false);

    process.env.CC_TOOL_LOG_REQUESTS = '1';
    requestLogger.persistProxyRequestSnapshot('claude', { requestId: 'enabled', model: 'claude-sonnet' });

    expect(requestLogger.isProxyRequestLoggingEnabled()).toBe(true);
    expect(readJsonLines(pathsStub.PATHS.requestSnapshots.claude)).toEqual([
      { requestId: 'enabled', model: 'claude-sonnet' }
    ]);
  });

  test('logs API requests when the middleware is enabled', () => {
    process.env.CC_TOOL_LOG_API_REQUESTS = 'true';
    const middleware = requestLogger.createApiRequestLogger();
    const next = vi.fn();
    const req = {
      method: 'POST',
      path: '/api/demo',
      originalUrl: '/api/demo?debug=1',
      url: '/api/demo?debug=1',
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'vitest'
      }
    };
    const res = {
      statusCode: 201,
      headersSent: false,
      json: vi.fn((body) => body),
      send: vi.fn((body) => body)
    };

    middleware(req, res, next);
    const payload = { ok: true };
    expect(res.json(payload)).toBe(payload);

    const entries = readJsonLines(path.join(pathsStub.PATHS.logs, 'api-requests.jsonl'));
    expect(requestLogger.isApiRequestLoggingEnabled()).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      method: 'POST',
      path: '/api/demo',
      url: '/api/demo?debug=1',
      statusCode: 201,
      ip: '127.0.0.1',
      userAgent: 'vitest'
    });
    expect(typeof entries[0].duration).toBe('number');
    expect(typeof entries[0].timestamp).toBe('string');
  });

  test('stores valid Claude templates and falls back when no template exists', () => {
    const fallback = requestLogger.loadClaudeRequestTemplate();
    expect(fallback.userId).toBe('');
    expect(Array.isArray(fallback.system)).toBe(true);
    expect(Array.isArray(fallback.tools)).toBe(true);
    expect(fallback.tools[0].name).toBe('Task');

    requestLogger.persistClaudeRequestTemplate({
      system: [{ type: 'text', text: 'too short' }],
      tools: [{ name: 'Task' }]
    });
    expect(fs.existsSync(pathsStub.PATHS.claudeRequestTemplate)).toBe(false);

    requestLogger.persistClaudeRequestTemplate({
      system: [{ type: 'text', text: 'x'.repeat(120) }],
      tools: [{ name: 'Task', input_schema: { type: 'object' } }],
      metadata: { user_id: 'user-123' }
    });

    expect(requestLogger.loadClaudeRequestTemplate()).toEqual({
      userId: 'user-123',
      system: [{ type: 'text', text: 'x'.repeat(120) }],
      tools: [{ name: 'Task', input_schema: { type: 'object' } }]
    });
  });
});
