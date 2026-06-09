'use strict';

const SETTINGS_API_PATH = require.resolve('../../../src/server/api/settings');
const MODEL_METADATA_PATH = require.resolve('../../../src/config/model-metadata');
const LOADER_PATH = require.resolve('../../../src/config/loader');

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

const mockReq = (o = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
  ...o,
});

const mockRes = () => {
  const r = { statusCode: 200, _data: null };
  r.status = vi.fn(c => { r.statusCode = c; return r; });
  r.json  = vi.fn(d => { r._data = d; return r; });
  return r;
};

// ── stubs ─────────────────────────────────────────────────────────────────────

let modelMetaStub;
let loaderStub;

function loadRouter() {
  delete require.cache[SETTINGS_API_PATH];
  delete require.cache[MODEL_METADATA_PATH];
  delete require.cache[LOADER_PATH];

  require.cache[MODEL_METADATA_PATH] = {
    id: MODEL_METADATA_PATH,
    filename: MODEL_METADATA_PATH,
    loaded: true,
    exports: modelMetaStub,
  };

  require.cache[LOADER_PATH] = {
    id: LOADER_PATH,
    filename: LOADER_PATH,
    loaded: true,
    exports: loaderStub,
  };

  return require(SETTINGS_API_PATH);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('settings API router', () => {
  beforeEach(() => {
    modelMetaStub = {
      MODEL_METADATA: {
        'claude-3-opus': {
          limit: { context: 200000, output: 4096 },
          pricing: { input: 15, output: 75 },
        },
        'claude-3-sonnet': {
          limit: { context: 200000, output: 4096 },
          pricing: { input: 3, output: 15 },
        },
      },
      METADATA_LAST_UPDATED: '2025-01-01',
      getDefaultSpeedTestModels: vi.fn().mockReturnValue(['claude-3-opus']),
      saveDefaultSpeedTestModels: vi.fn(v => v || []),
    };

    loaderStub = {
      loadConfig: vi.fn().mockReturnValue({
        projectsDir: '/home/user/projects',
        modelMetadataOverrides: {},
      }),
      saveConfig: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[SETTINGS_API_PATH];
    delete require.cache[MODEL_METADATA_PATH];
    delete require.cache[LOADER_PATH];
  });

  // ── GET /model-settings ───────────────────────────────────────────────────

  it('GET /model-settings returns models, overrides, builtinModelIds, lastUpdated, defaultSpeedTestModels', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'get', '/model-settings');
    const req = mockReq();
    const res = mockRes();

    handler(req, res);

    const data = res._data;
    expect(data).toHaveProperty('models');
    expect(data).toHaveProperty('overrides');
    expect(data).toHaveProperty('builtinModelIds');
    expect(data).toHaveProperty('lastUpdated', '2025-01-01');
    expect(data).toHaveProperty('defaultSpeedTestModels');
    expect(data.builtinModelIds).toContain('claude-3-opus');
  });

  it('GET /model-settings merges overrides into built-in metadata', () => {
    loaderStub.loadConfig.mockReturnValue({
      projectsDir: '/home/user/projects',
      modelMetadataOverrides: {
        'claude-3-opus': { limit: { context: 100000 } },
      },
    });

    const router = loadRouter();
    const handler = findHandler(router, 'get', '/model-settings');
    const req = mockReq();
    const res = mockRes();

    handler(req, res);

    expect(res._data.models['claude-3-opus'].limit.context).toBe(100000);
    // output is preserved from built-in
    expect(res._data.models['claude-3-opus'].limit.output).toBe(4096);
  });

  it('GET /model-settings returns 500 on loadConfig error', () => {
    loaderStub.loadConfig.mockImplementation(() => { throw new Error('read fail'); });

    const router = loadRouter();
    const handler = findHandler(router, 'get', '/model-settings');
    const req = mockReq();
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'read fail' });
  });

  // ── POST /model-settings ──────────────────────────────────────────────────

  it('POST /model-settings with valid overrides saves and returns success', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          'my-model': {
            limit: { context: 8192, output: 1024 },
            pricing: { input: 0.5, output: 1.5 },
          },
        },
        defaultSpeedTestModels: ['my-model'],
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(loaderStub.saveConfig).toHaveBeenCalled();
    expect(res._data).toMatchObject({ success: true });
  });

  it('POST /model-settings does not force projectsDir into saved config', () => {
    loaderStub.loadConfig.mockReturnValue({
      modelMetadataOverrides: {},
    });

    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          'my-model': { limit: { context: 8192 } },
        },
      },
    });
    const res = mockRes();

    handler(req, res);

    const savedConfig = loaderStub.saveConfig.mock.calls[0][0];
    expect(savedConfig).not.toHaveProperty('projectsDir');
  });

  it('POST /model-settings returns 400 when overrides is an array', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({ body: { overrides: ['not', 'an', 'object'] } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/overrides must be an object/i);
  });

  it('POST /model-settings returns 400 when overrides is null', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({ body: { overrides: null } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/overrides must be an object/i);
  });

  it('POST /model-settings returns 400 when modelId is an empty string key', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          '   ': { limit: { context: 100 } },
        },
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/invalid model id/i);
  });

  it('POST /model-settings returns 400 when limit is not an object', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          'my-model': { limit: 'not-an-object' },
        },
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/limit must be an object/i);
  });

  it('POST /model-settings returns 400 when limit.context is zero (non-positive)', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          'my-model': { limit: { context: 0 } },
        },
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/limit\.context must be a positive number/i);
  });

  it('POST /model-settings returns 400 when pricing.input is negative', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          'my-model': { pricing: { input: -1, output: 1 } },
        },
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/pricing\.input must be a non-negative number/i);
  });

  it('POST /model-settings returns 400 when pricing.output is negative', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          'my-model': { pricing: { input: 1, output: -0.5 } },
        },
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/pricing\.output must be a non-negative number/i);
  });

  it('POST /model-settings allows zero pricing (non-negative = valid)', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          'free-model': { pricing: { input: 0, output: 0 } },
        },
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(res._data).toMatchObject({ success: true });
  });

  it('POST /model-settings returns 500 on saveConfig error', () => {
    loaderStub.saveConfig.mockImplementation(() => { throw new Error('write fail'); });

    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({ body: { overrides: { 'ok-model': { limit: { context: 1000 } } } } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'write fail' });
  });

  // ── DELETE /model-settings/:modelId ──────────────────────────────────────

  it('DELETE /model-settings/:modelId removes the override and returns success', () => {
    loaderStub.loadConfig.mockReturnValue({
      projectsDir: '/home/user/projects',
      modelMetadataOverrides: { 'claude-3-opus': { limit: { context: 1 } } },
    });

    const router = loadRouter();
    const handler = findHandler(router, 'delete', '/model-settings/:modelId');
    const req = mockReq({ params: { modelId: 'claude-3-opus' } });
    const res = mockRes();

    handler(req, res);

    expect(loaderStub.saveConfig).toHaveBeenCalled();
    const savedConfig = loaderStub.saveConfig.mock.calls[0][0];
    expect(savedConfig.modelMetadataOverrides).not.toHaveProperty('claude-3-opus');
    expect(res._data).toMatchObject({ success: true, modelId: 'claude-3-opus' });
  });

  it('DELETE /model-settings/:modelId does not force projectsDir into saved config', () => {
    loaderStub.loadConfig.mockReturnValue({
      modelMetadataOverrides: { 'claude-3-opus': { limit: { context: 1 } } },
    });

    const router = loadRouter();
    const handler = findHandler(router, 'delete', '/model-settings/:modelId');
    const req = mockReq({ params: { modelId: 'claude-3-opus' } });
    const res = mockRes();

    handler(req, res);

    const savedConfig = loaderStub.saveConfig.mock.calls[0][0];
    expect(savedConfig).not.toHaveProperty('projectsDir');
  });

  it('DELETE /model-settings/:modelId returns 500 on loadConfig error', () => {
    loaderStub.loadConfig.mockImplementation(() => { throw new Error('read fail'); });

    const router = loadRouter();
    const handler = findHandler(router, 'delete', '/model-settings/:modelId');
    const req = mockReq({ params: { modelId: 'some-model' } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'read fail' });
  });
});
