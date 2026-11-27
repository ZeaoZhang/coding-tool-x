'use strict';

const SETTINGS_API_PATH = require.resolve('../../../src/server/api/settings');
const MODEL_METADATA_PATH = require.resolve('../../../src/config/model-metadata');
const LOADER_PATH = require.resolve('../../../src/config/loader');
const MODEL_ROLE_SETTINGS_PATH = require.resolve('../../../src/platforms/drivers/omp/model-role-settings');
const FALLBACK_STORE_PATH = require.resolve('../../../src/shared/model-fallback-store');
const PLATFORM_CATALOG_PATH = require.resolve('../../../src/server/services/platform-catalog');
// 真实目录用于其余（模型元数据等）用例，只覆盖 driver() 以模拟渠道
const REAL_PLATFORM_CATALOG = require('../../../src/server/services/platform-catalog');

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
let modelRoleStub;
let fallbackStoreStub;
let platformCatalogStub;

function loadRouter() {
  delete require.cache[SETTINGS_API_PATH];
  delete require.cache[MODEL_METADATA_PATH];
  delete require.cache[LOADER_PATH];
  delete require.cache[MODEL_ROLE_SETTINGS_PATH];
  delete require.cache[FALLBACK_STORE_PATH];
  delete require.cache[PLATFORM_CATALOG_PATH];

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

  require.cache[MODEL_ROLE_SETTINGS_PATH] = {
    id: MODEL_ROLE_SETTINGS_PATH,
    filename: MODEL_ROLE_SETTINGS_PATH,
    loaded: true,
    exports: modelRoleStub,
  };

  require.cache[FALLBACK_STORE_PATH] = {
    id: FALLBACK_STORE_PATH,
    filename: FALLBACK_STORE_PATH,
    loaded: true,
    exports: fallbackStoreStub,
  };

  require.cache[PLATFORM_CATALOG_PATH] = {
    id: PLATFORM_CATALOG_PATH,
    filename: PLATFORM_CATALOG_PATH,
    loaded: true,
    exports: platformCatalogStub,
  };

  return require(SETTINGS_API_PATH);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('settings API router', () => {
  beforeEach(() => {
    modelRoleStub = {
      readOmpModelRoleSettings: vi.fn(() => ({ roles: {}, modelOptions: [], unavailableRoles: {} })),
      updateOmpModelRoleSettings: vi.fn(() => ({ roles: {}, modelOptions: [], unavailableRoles: {} })),
      readOmpFallbackChainsForUi: vi.fn(() => ({ chains: [], modelOptions: [], unavailableChains: {} })),
      updateOmpFallbackChainsForUi: vi.fn(() => ({ chains: [], modelOptions: [], unavailableChains: {} })),
    };
    fallbackStoreStub = {
      readPlatformChains: vi.fn(() => []),
      writePlatformChains: vi.fn((platform, chains) => chains),
      listPlatformModelOptions: vi.fn(() => [
        { channelId: 'a', channelName: 'A', model: 'glm-4.6' },
        { channelId: 'b', channelName: 'B', model: 'qwen-max' },
      ]),
    };
    platformCatalogStub = {
      ...REAL_PLATFORM_CATALOG,
      getPlatformCatalog: () => ({
        ...REAL_PLATFORM_CATALOG.getPlatformCatalog(),
        driver: () => ({
          getEnabled: () => ({
            status: 'ok',
            data: [
              { id: 'a', name: 'A', enabled: true, models: ['glm-4.6'] },
              { id: 'b', name: 'B', enabled: true, models: ['qwen-max'] },
            ],
          }),
        }),
      }),
    };

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
      MODEL_ALIASES: {},
      METADATA_LAST_UPDATED: '2025-01-01',
      METADATA_SOURCE: {
        name: 'models.dev',
        url: 'https://models.dev/api.json',
        lastUpdated: '2025-01-01'
      },
      getModelIdsByToolType: vi.fn((toolType) => (
        toolType === 'claude' ? ['claude-3-opus'] : ['deepseek/deepseek-v4-pro']
      )),
      getDefaultSpeedTestModels: vi.fn().mockReturnValue({
        claude: 'claude-3-opus',
        codex: 'gpt-5.4',
        gemini: 'gemini-2.5-pro'
      })
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
    expect(data).toHaveProperty('metadataSource', {
      name: 'models.dev',
      url: 'https://models.dev/api.json',
      lastUpdated: '2025-01-01'
    });
    expect(data.toolModels).toMatchObject({
      claude: ['claude-3-opus'],
      codex: ['deepseek/deepseek-v4-pro'],
      gemini: ['deepseek/deepseek-v4-pro'],
      opencode: ['deepseek/deepseek-v4-pro'],
      omp: ['deepseek/deepseek-v4-pro']
    });
    expect(data).toHaveProperty('schemaVersion', 2);
    expect(data).toHaveProperty('fieldSchema');
    expect(data).toHaveProperty('resolvedModels');
    expect(data).toHaveProperty('provenance');
    expect(data.builtinModelIds).toContain('claude-3-opus');
  });

  it('keeps the /model-metadata compatibility alias', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'get', '/model-metadata');
    const res = mockRes();

    handler(mockReq(), res);

    expect(res._data).toMatchObject({
      schemaVersion: 2,
      defaultSpeedTestModels: {
        claude: 'claude-3-opus',
        codex: 'gpt-5.4',
        gemini: 'gemini-2.5-pro'
      }
    });
  });

  it('GET /model-settings merges overrides into built-in metadata', () => {
    loaderStub.loadConfig.mockReturnValue({
      projectsDir: '/home/user/projects',
      modelMetadataOverrides: {
        'claude-3-opus': { limit: { context: 100000 } },
      },
      defaultSpeedTestModels: { claude: 'custom-claude', codex: 'custom-codex' },
    });

    const router = loadRouter();
    const handler = findHandler(router, 'get', '/model-settings');
    const req = mockReq();
    const res = mockRes();

    handler(req, res);

    expect(res._data.models['claude-3-opus'].limit.context).toBe(100000);
    // output is preserved from built-in
    expect(res._data.defaultSpeedTestModels).toMatchObject({
      claude: 'custom-claude',
      codex: 'custom-codex',
      opencode: 'custom-codex',
      omp: 'custom-codex',
      gemini: 'gemini-2.5-pro'
    });
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
        defaultSpeedTestModels: { claude: ' my-model ' },
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(loaderStub.saveConfig).toHaveBeenCalled();
    const savedConfig = loaderStub.saveConfig.mock.calls[0][0];
    expect(savedConfig.defaultSpeedTestModels.claude).toBe('my-model');
    expect(res._data.defaultSpeedTestModels).toMatchObject({
      claude: 'my-model',
      codex: 'gpt-5.4',
      opencode: 'gpt-5.4',
      omp: 'gpt-5.4',
      gemini: 'gemini-2.5-pro'
    });
    expect(res._data).toMatchObject({ success: true });
  });
  it('POST /model-settings rejects non-object speed test models', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({ body: { defaultSpeedTestModels: ['invalid'] } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data).toEqual({ error: 'defaultSpeedTestModels must be an object' });
    expect(loaderStub.saveConfig).not.toHaveBeenCalled();
  });

  it('POST /model-settings persists versioned complete model definitions', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        definitions: {
          'future-model': {
            id: 'future-model',
            metadataMode: 'manual',
            reasoning: true,
            thinking: { mode: 'effort', efforts: ['low', 'high'] },
            contextWindow: 500000,
            maxTokens: 64000,
            compat: { supportsDeveloperRole: true }
          }
        }
      }
    });
    const res = mockRes();

    handler(req, res);

    const savedConfig = loaderStub.saveConfig.mock.calls[0][0];
    expect(savedConfig.modelMetadataSchemaVersion).toBe(2);
    expect(savedConfig.modelDefinitions['future-model']).toEqual(expect.objectContaining({
      id: 'future-model',
      contextWindow: 500000
    }));
    expect(res._data).toEqual(expect.objectContaining({ success: true, schemaVersion: 2 }));
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

  it('POST /model-settings returns 400 when pricing.cacheRead is negative', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/model-settings');
    const req = mockReq({
      body: {
        overrides: {
          'my-model': { pricing: { input: 1, output: 2, cacheRead: -0.1 } },
        },
      },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/pricing\.cacheRead must be a non-negative number/i);
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

describe('settings API router - omp fallback chains via the shared endpoint', () => {
  beforeEach(() => {
    modelRoleStub = {
      readOmpModelRoleSettings: vi.fn(() => ({ roles: {}, modelOptions: [], unavailableRoles: {} })),
      updateOmpModelRoleSettings: vi.fn(() => ({ roles: {}, modelOptions: [], unavailableRoles: {} })),
      readOmpFallbackChainsForUi: vi.fn(() => ({
        chains: [{ from: 'ctx-zhipu/glm-4.6', targets: [{ channelId: 'omp-channel', model: 'glm-4.5-air' }] }],
        modelOptions: [{ channelId: 'omp-channel', channelName: 'Zhipu', model: 'glm-4.5-air' }],
        unavailableChains: {}
      })),
      updateOmpFallbackChainsForUi: vi.fn(() => ({
        chains: [{ from: 'ctx-zhipu/glm-4.6', targets: [{ channelId: 'omp-channel', model: 'glm-4.5-air' }] }],
        modelOptions: [{ channelId: 'omp-channel', channelName: 'Zhipu', model: 'glm-4.5-air' }],
        unavailableChains: {}
      })),
    };
    fallbackStoreStub = { readPlatformChains: vi.fn(() => []), writePlatformChains: vi.fn(), listPlatformModelOptions: vi.fn(() => []) };
    platformCatalogStub = {
      ...REAL_PLATFORM_CATALOG,
      getPlatformCatalog: () => ({
        ...REAL_PLATFORM_CATALOG.getPlatformCatalog(),
        driver: () => ({
          getEnabled: () => ({
            status: 'ok',
            data: [{
              id: 'omp-channel',
              name: 'Zhipu',
              enabled: true,
              providerKey: 'zhipu',
              models: [{ id: 'glm-4.5-air' }, { id: 'glm-4.6' }]
            }]
          })
        })
      })
    };
  });

  it('GET /model-fallback-chains?platform=omp returns the unified shape', () => {
    const router = loadRouter();
    const res = mockRes();
    findHandler(router, 'get', '/model-fallback-chains')(mockReq({ query: { platform: 'omp' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      platform: 'omp',
      chains: [{ from: 'ctx-zhipu/glm-4.6', targets: [{ channelId: 'omp-channel', model: 'glm-4.5-air' }] }]
    }));
  });

  it('PUT /model-fallback-chains with platform=omp writes the native OMP chain', () => {
    const router = loadRouter();
    const res = mockRes();
    const chains = [{ from: 'ctx-zhipu/glm-4.6', targets: [{ channelId: 'omp-channel', model: 'glm-4.5-air' }] }];

    findHandler(router, 'put', '/model-fallback-chains')(mockReq({ body: { platform: 'omp', chains } }), res);

    expect(modelRoleStub.updateOmpFallbackChainsForUi).toHaveBeenCalledWith(chains);
    expect(fallbackStoreStub.writePlatformChains).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('the old /omp-fallback-chains endpoint is gone', () => {
    const router = loadRouter();
    expect(findHandler(router, 'get', '/omp-fallback-chains')).toBeNull();
    expect(findHandler(router, 'put', '/omp-fallback-chains')).toBeNull();
  });
});

describe('settings API router - platform model fallback chains', () => {
  beforeEach(() => {
    modelRoleStub = {
      readOmpModelRoleSettings: vi.fn(() => ({ roles: {}, modelOptions: [], unavailableRoles: {} })),
      updateOmpModelRoleSettings: vi.fn(() => ({ roles: {}, modelOptions: [], unavailableRoles: {} })),
      readOmpFallbackChainsForUi: vi.fn(() => ({ chains: [], modelOptions: [], unavailableChains: {} })),
      updateOmpFallbackChainsForUi: vi.fn(() => ({ chains: [], modelOptions: [], unavailableChains: {} })),
    };
    fallbackStoreStub = {
      readPlatformChains: vi.fn(() => [{ from: 'glm-4.6', targets: [{ channelId: 'b', model: 'qwen-max' }] }]),
      writePlatformChains: vi.fn((platform, chains) => chains),
      listPlatformModelOptions: vi.fn(() => [
        { channelId: 'a', channelName: 'A', model: 'glm-4.6' },
        { channelId: 'b', channelName: 'B', model: 'qwen-max' },
      ]),
    };
    platformCatalogStub = {
      ...REAL_PLATFORM_CATALOG,
      getPlatformCatalog: () => ({
        ...REAL_PLATFORM_CATALOG.getPlatformCatalog(),
        driver: () => ({
          getEnabled: () => ({
            status: 'ok',
            data: [
              { id: 'a', name: 'A', enabled: true, models: ['glm-4.6'] },
              { id: 'b', name: 'B', enabled: true, models: ['qwen-max'] }
            ]
          })
        })
      })
    };
  });

  it('GET /model-fallback-chains returns chains + channel/model options', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'get', '/model-fallback-chains');
    const res = mockRes();

    handler(mockReq({ query: { platform: 'claude' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      platform: 'claude',
      chains: [{ from: 'glm-4.6', targets: [{ channelId: 'b', model: 'qwen-max' }] }],
      modelOptions: expect.arrayContaining([{ channelId: 'b', channelName: 'B', model: 'qwen-max' }])
    }));
  });

  it('GET /model-fallback-chains rejects an unsupported platform', () => {
    const router = loadRouter();
    const res = mockRes();
    findHandler(router, 'get', '/model-fallback-chains')(mockReq({ query: { platform: 'unknown' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('PUT /model-fallback-chains validates channel and declared model', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'put', '/model-fallback-chains');

    const unknownChannel = mockRes();
    handler(mockReq({ body: { platform: 'claude', chains: [
      { from: 'glm-4.6', targets: [{ channelId: 'ghost', model: 'x' }] }
    ] } }), unknownChannel);
    expect(unknownChannel.statusCode).toBe(400);

    const undeclared = mockRes();
    handler(mockReq({ body: { platform: 'claude', chains: [
      { from: 'glm-4.6', targets: [{ channelId: 'b', model: 'not-declared' }] }
    ] } }), undeclared);
    expect(undeclared.statusCode).toBe(400);

    const notArray = mockRes();
    handler(mockReq({ body: { platform: 'claude', chains: { a: 1 } } }), notArray);
    expect(notArray.statusCode).toBe(400);

    expect(fallbackStoreStub.writePlatformChains).not.toHaveBeenCalled();
  });

  it('PUT /model-fallback-chains saves a valid chain', () => {
    const router = loadRouter();
    const res = mockRes();
    const chains = [{ from: 'glm-4.6', targets: [{ channelId: 'b', model: 'qwen-max' }] }];

    findHandler(router, 'put', '/model-fallback-chains')(mockReq({ body: { platform: 'claude', chains } }), res);

    expect(fallbackStoreStub.writePlatformChains).toHaveBeenCalledWith('claude', chains);
    expect(res.statusCode).toBe(200);
  });
});
