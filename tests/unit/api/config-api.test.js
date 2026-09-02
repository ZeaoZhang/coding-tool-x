/**
 * Tests for src/server/api/config.js
 *
 * Pattern: inject vi.fn() stubs into require.cache before requiring the module
 * under test. Tests exercise internal logic (clampNumber, uniqueModels,
 * parseBooleanQuery, validateModelList) through the POST /advanced and
 * POST /default-models routes.
 */

const LOADER_PATH         = require.resolve('../../../src/config/loader');
const DEFAULT_PATH        = require.resolve('../../../src/config/default');
const CHANNELS_PATH       = require.resolve('../../../src/platforms/drivers/claude/channels-implementation');
const CODEX_CH_PATH       = require.resolve('../../../src/platforms/drivers/codex/channels-implementation');
const GEMINI_CH_PATH      = require.resolve('../../../src/platforms/drivers/gemini/channels-implementation');
const MODEL_DET_PATH      = require.resolve('../../../src/server/services/model-detector');
const API_PATH            = require.resolve('../../../src/server/api/config');

// Stub references recreated in beforeEach
let loadConfig;
let saveConfig;
let router;

function injectStubs() {
  loadConfig = vi.fn(() => ({
    projectsDir: '/tmp/projects',
    ports: { proxy: 9960, webUI: 9999, codexProxy: 9961, geminiProxy: 9962, opencodeProxy: 9963 },
    pricing: {
      claude:  { mode: 'auto', input: 3,    output: 15 },
      codex:   { mode: 'auto', input: 2,    output: 8  },
      gemini:  { mode: 'auto', input: 1.25, output: 10, cacheRead: 0.125 },
    },
    defaultModels: {
      claude: ['claude-sonnet-4-6'],
      codex:  ['gpt-4.1'],
      gemini: ['gemini-2.5-pro'],
    },
    modelDiscovery: { useV1ModelsEndpoint: false },
    currentProject: 'test',
  }));
  saveConfig = vi.fn();

  require.cache[LOADER_PATH] = {
    id: LOADER_PATH, filename: LOADER_PATH, loaded: true,
    exports: { loadConfig, saveConfig },
  };

  require.cache[DEFAULT_PATH] = {
    id: DEFAULT_PATH, filename: DEFAULT_PATH, loaded: true,
    exports: {
      ports: { proxy: 9960 },
      pricing: {
        claude:  { mode: 'auto', input: 3,    output: 15 },
        codex:   { mode: 'auto', input: 2,    output: 8  },
        gemini:  { mode: 'auto', input: 1.25, output: 10, cacheRead: 0.125 },
      },
      defaultModels: {
        claude: ['claude-sonnet-4-6'],
        codex:  ['gpt-4.1'],
        gemini: ['gemini-2.5-pro'],
      },
      modelDiscovery: { useV1ModelsEndpoint: false },
    },
  };

  require.cache[CHANNELS_PATH] = {
    id: CHANNELS_PATH, filename: CHANNELS_PATH, loaded: true,
    exports: { getAllChannels: vi.fn(() => []) },
  };

  require.cache[CODEX_CH_PATH] = {
    id: CODEX_CH_PATH, filename: CODEX_CH_PATH, loaded: true,
    exports: { getChannels: vi.fn(() => ({ channels: [] })) },
  };

  require.cache[GEMINI_CH_PATH] = {
    id: GEMINI_CH_PATH, filename: GEMINI_CH_PATH, loaded: true,
    exports: { getChannels: vi.fn(() => ({ channels: [] })) },
  };

  require.cache[MODEL_DET_PATH] = {
    id: MODEL_DET_PATH, filename: MODEL_DET_PATH, loaded: true,
    exports: { probeModelAvailability: vi.fn(), fetchModelsFromProvider: vi.fn() },
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function findHandler(router, method, routePath) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) {
      for (const s of layer.route.stack) {
        if (s.method === method) return s.handle;
      }
    }
  }
  return null;
}

const mockReq = (o = {}) => ({ body: {}, params: {}, query: {}, headers: {}, ...o });
const mockRes = () => {
  const r = { statusCode: 200, _data: null };
  r.status = vi.fn(c => { r.statusCode = c; return r; });
  r.json   = vi.fn(d => { r._data = d; return r; });
  return r;
};

// ── setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  injectStubs();
  delete require.cache[API_PATH];
  router = require('../../../src/server/api/config');
});

afterEach(() => {
  delete require.cache[API_PATH];
});

// ── GET /advanced ─────────────────────────────────────────────────────────────

describe('GET /advanced', () => {
  test('returns config fields', () => {
    const handler = findHandler(router, 'get', '/advanced');
    expect(handler).not.toBeNull();

    const req = mockReq();
    const res = mockRes();
    handler(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res._data;
    expect(data).toHaveProperty('ports');
    expect(data).toHaveProperty('pricing');
    expect(data).toHaveProperty('modelDiscovery');
    expect(loadConfig).toHaveBeenCalled();
  });
});

// ── POST /advanced ────────────────────────────────────────────────────────────

describe('POST /advanced', () => {
  test('saves config successfully with valid body', () => {
    const handler = findHandler(router, 'post', '/advanced');
    const req = mockReq({ body: { pricing: {} } });
    const res = mockRes();
    handler(req, res);

    expect(saveConfig).toHaveBeenCalled();
    expect(res._data.success).toBe(true);
  });

  test('does not force projectsDir into saved advanced config', () => {
    loadConfig.mockReturnValueOnce({
      ports: { proxy: 9960, webUI: 9999, codexProxy: 9961, geminiProxy: 9962, opencodeProxy: 9963 },
      pricing: {
        claude:  { mode: 'auto', input: 3, output: 15 },
        codex:   { mode: 'auto', input: 2, output: 8 },
        gemini:  { mode: 'auto', input: 1.25, output: 10, cacheRead: 0.125 },
      },
      modelDiscovery: { useV1ModelsEndpoint: false },
      currentProject: 'test',
    });

    const handler = findHandler(router, 'post', '/advanced');
    const req = mockReq({ body: { maxLogs: 120 } });
    const res = mockRes();
    handler(req, res);

    const saved = saveConfig.mock.calls[0][0];
    expect(saved).not.toHaveProperty('projectsDir');
  });

  test('clamps negative pricing values to 0', () => {
    const handler = findHandler(router, 'post', '/advanced');
    const req = mockReq({
      body: {
        pricing: {
          claude: { mode: 'custom', input: -5, output: -100 },
        },
      },
    });
    const res = mockRes();
    handler(req, res);

    expect(saveConfig).toHaveBeenCalled();
    const saved = saveConfig.mock.calls[0][0];
    expect(saved.pricing.claude.input).toBe(0);
    expect(saved.pricing.claude.output).toBe(0);
  });

  test('clamps pricing values above 1000 to 1000', () => {
    const handler = findHandler(router, 'post', '/advanced');
    const req = mockReq({
      body: {
        pricing: {
          codex: { mode: 'custom', input: 9999, output: 2000 },
        },
      },
    });
    const res = mockRes();
    handler(req, res);

    expect(saveConfig).toHaveBeenCalled();
    const saved = saveConfig.mock.calls[0][0];
    expect(saved.pricing.codex.input).toBe(1000);
    expect(saved.pricing.codex.output).toBe(1000);
  });

  test('returns 400 for invalid port (out of range)', () => {
    const handler = findHandler(router, 'post', '/advanced');
    const req = mockReq({ body: { ports: { proxy: 80 } } });
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('returns 500 when saveConfig throws', () => {
    saveConfig.mockImplementation(() => { throw new Error('disk error'); });
    const handler = findHandler(router, 'post', '/advanced');
    const req = mockReq({ body: {} });
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(500);
  });
});

// ── POST /default-models ──────────────────────────────────────────────────────

describe('POST /default-models', () => {
  test('saves valid defaultModels successfully', () => {
    const handler = findHandler(router, 'post', '/default-models');
    const req = mockReq({
      body: {
        defaultModels: { claude: ['claude-opus-4-5', 'claude-haiku-4-5'] },
      },
    });
    const res = mockRes();
    handler(req, res);

    expect(res._data.success).toBe(true);
    expect(saveConfig).toHaveBeenCalled();
  });

  test('does not force projectsDir into saved defaultModels config', () => {
    loadConfig.mockReturnValueOnce({
      ports: { proxy: 9960, webUI: 9999, codexProxy: 9961, geminiProxy: 9962, opencodeProxy: 9963 },
      pricing: {
        claude:  { mode: 'auto', input: 3, output: 15 },
        codex:   { mode: 'auto', input: 2, output: 8 },
        gemini:  { mode: 'auto', input: 1.25, output: 10, cacheRead: 0.125 },
      },
      defaultModels: {
        claude: ['claude-sonnet-4-6'],
        codex:  ['gpt-4.1'],
        gemini: ['gemini-2.5-pro'],
      },
      modelDiscovery: { useV1ModelsEndpoint: false },
      currentProject: 'test',
    });

    const handler = findHandler(router, 'post', '/default-models');
    const req = mockReq({
      body: {
        defaultModels: { claude: ['claude-opus-4-5'] },
      },
    });
    const res = mockRes();
    handler(req, res);

    const saved = saveConfig.mock.calls[0][0];
    expect(saved).not.toHaveProperty('projectsDir');
  });

  test('returns 400 when defaultModels is not an object', () => {
    const handler = findHandler(router, 'post', '/default-models');
    const req = mockReq({ body: { defaultModels: 'bad' } });
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when model array is empty', () => {
    const handler = findHandler(router, 'post', '/default-models');
    const req = mockReq({ body: { defaultModels: { claude: [] } } });
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._data.details).toHaveProperty('claude');
  });

  test('returns 400 when model list exceeds 50 entries', () => {
    const handler = findHandler(router, 'post', '/default-models');
    const models = Array.from({ length: 51 }, (_, i) => `model-${i}`);
    const req = mockReq({ body: { defaultModels: { claude: models } } });
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._data.details.claude).toMatch(/50/);
  });

  test('returns 400 when a model entry is not a string', () => {
    const handler = findHandler(router, 'post', '/default-models');
    const req = mockReq({ body: { defaultModels: { codex: [123] } } });
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._data.details.codex).toMatch(/string/);
  });

  test('returns 400 when a model name contains invalid characters', () => {
    const handler = findHandler(router, 'post', '/default-models');
    const req = mockReq({ body: { defaultModels: { gemini: ['bad model!'] } } });
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._data.details.gemini).toMatch(/invalid/i);
  });

  test('deduplicates models (case-sensitive) before saving', () => {
    const handler = findHandler(router, 'post', '/default-models');
    // Input has three entries where the first and second are identical strings.
    // validateModelList must collapse the exact duplicate → cleaned = ['claude-sonnet-4-6', 'claude-haiku-4-5']
    const req = mockReq({
      body: {
        defaultModels: {
          claude: ['claude-sonnet-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
        },
      },
    });
    const res = mockRes();
    handler(req, res);

    expect(res._data.success).toBe(true);
    // Response defaultModels.claude must contain only the 2 deduplicated entries
    const claudeModels = res._data.defaultModels.claude;
    expect(claudeModels.filter(m => m === 'claude-sonnet-4-6')).toHaveLength(1);
    expect(claudeModels).toContain('claude-haiku-4-5');
  });

  test('returns 500 when saveConfig throws', () => {
    saveConfig.mockImplementation(() => { throw new Error('io error'); });
    const handler = findHandler(router, 'post', '/default-models');
    const req = mockReq({
      body: { defaultModels: { claude: ['claude-sonnet-4-6'] } },
    });
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(500);
  });
});

// ── GET /default-models ───────────────────────────────────────────────────────

describe('GET /default-models', () => {
  test('returns defaultModels without probing when probe=false', async () => {
    const handler = findHandler(router, 'get', '/default-models');
    const req = mockReq({ query: { probe: 'false' } });
    const res = mockRes();
    await handler(req, res);

    expect(res._data).toHaveProperty('defaultModels');
    expect(res._data.probed).toBe(false);
  });
});
