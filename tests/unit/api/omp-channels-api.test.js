function findHandler(router, method, routePath) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) {
      for (const stackItem of layer.route.stack) {
        if (stackItem.method === method) return stackItem.handle;
      }
    }
  }
  return null;
}

function makeRes() {
  return {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
}

let getChannels;
let createChannel;
let updateChannel;
let deleteChannel;
let saveChannelOrder;
let getSchedulerState;
let getChannelHealthStatus;
let resetChannelHealth;
let broadcastSchedulerState;
let testChannelSpeed;
let sanitizeBatchConcurrency;
let runWithConcurrencyLimit;
let fetchModelsFromProvider;
let probeModelAvailability;
let getCachedOmpAuthProviderSnapshot;
let getOmpAuthProviderCacheMeta;
let findAuthProviderForKey;
let isOmpInstalled;
let routerFactory;

beforeEach(() => {
  getChannels = vi.fn(() => ({
    channels: [
      {
        id: 'omp-1',
        name: 'OMP One',
        baseUrl: 'https://omp.one/v1',
        enabled: true,
        gatewaySourceType: 'codex',
        providerKey: 'codex',
        providerApi: 'openai-completions',
        model: 'gpt-5',
        allowedModels: ['gpt-5-mini']
      },
      {
        id: 'omp-2',
        name: 'OMP Two',
        baseUrl: 'https://omp.two/v1',
        enabled: false,
        gatewaySourceType: 'gemini',
        allowedModels: ['gemini-2.5-pro']
      }
    ]
  }));
  createChannel = vi.fn((name, baseUrl, apiKey, options) => ({
    id: 'omp-new',
    name,
    baseUrl,
    apiKey,
    ...options
  }));
  updateChannel = vi.fn((id, updates) => ({ id, ...updates }));
  deleteChannel = vi.fn(async () => ({ success: true }));
  saveChannelOrder = vi.fn();
  getSchedulerState = vi.fn(() => ({ queue: 0 }));
  getChannelHealthStatus = vi.fn((id) => ({ id, healthy: true }));
  resetChannelHealth = vi.fn();
  broadcastSchedulerState = vi.fn();
  testChannelSpeed = vi.fn(async (channel, timeout, type) => ({
    channelId: channel.id,
    success: channel.id !== 'omp-2',
    latency: channel.id === 'omp-2' ? null : 88,
    timeout,
    gatewaySourceType: type
  }));
  sanitizeBatchConcurrency = vi.fn((value) => value || 2);
  runWithConcurrencyLimit = vi.fn(async (items, _concurrency, worker) => Promise.all(items.map(worker)));
  fetchModelsFromProvider = vi.fn(async (channel) => {
    if (channel.id === 'omp-1') {
      return { models: [], cached: false, lastChecked: '2026-01-01T00:00:00Z' };
    }
    return { models: ['gpt-5', 'gpt-5'], cached: false, lastChecked: '2026-01-02T00:00:00Z' };
  });
  probeModelAvailability = vi.fn(async () => ({
    availableModels: ['gpt-5', 'gpt-5-mini'],
    cached: false,
    lastChecked: '2026-01-03T00:00:00Z'
  }));
  getCachedOmpAuthProviderSnapshot = vi.fn(() => ({
    available: true,
    providers: [
      {
        id: 'openai-codex',
        name: 'ChatGPT Plus/Pro (Codex Subscription)',
        loggedIn: true,
        accountCount: 1,
        accounts: [{ index: 1, identity: 'co***x@example.com' }],
        checked: true
      }
    ],
    aliases: { codex: 'openai-codex' }
  }));
  getOmpAuthProviderCacheMeta = vi.fn(() => ({
    cached: true,
    stale: false,
    refreshing: false,
    fallback: false,
    checkedAt: '2026-01-01T00:00:00.000Z',
    error: null
  }));
  findAuthProviderForKey = vi.fn((providerKey, snapshot) => {
    if (providerKey === 'codex') return snapshot?.providers?.[0] || null;
    return null;
  });
  isOmpInstalled = vi.fn(() => true);

  require.cache[require.resolve('../../../src/platforms/drivers/omp/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/channels-implementation'),
    loaded: true,
    exports: {
      getChannels,
      createChannel,
      updateChannel,
      deleteChannel,
      saveChannelOrder
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/sessions-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/sessions-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/sessions-implementation'),
    loaded: true,
    exports: { isOmpInstalled }
  };
  require.cache[require.resolve('../../../src/server/services/channel-scheduler')] = {
    id: require.resolve('../../../src/server/services/channel-scheduler'),
    filename: require.resolve('../../../src/server/services/channel-scheduler'),
    loaded: true,
    exports: { getSchedulerState }
  };
  require.cache[require.resolve('../../../src/server/services/channel-health')] = {
    id: require.resolve('../../../src/server/services/channel-health'),
    filename: require.resolve('../../../src/server/services/channel-health'),
    loaded: true,
    exports: { getChannelHealthStatus, resetChannelHealth }
  };
  require.cache[require.resolve('../../../src/server/websocket-server')] = {
    id: require.resolve('../../../src/server/websocket-server'),
    filename: require.resolve('../../../src/server/websocket-server'),
    loaded: true,
    exports: { broadcastSchedulerState }
  };
  require.cache[require.resolve('../../../src/server/services/speed-test')] = {
    id: require.resolve('../../../src/server/services/speed-test'),
    filename: require.resolve('../../../src/server/services/speed-test'),
    loaded: true,
    exports: { testChannelSpeed, sanitizeBatchConcurrency, runWithConcurrencyLimit }
  };
  require.cache[require.resolve('../../../src/server/services/model-detector')] = {
    id: require.resolve('../../../src/server/services/model-detector'),
    filename: require.resolve('../../../src/server/services/model-detector'),
    loaded: true,
    exports: { fetchModelsFromProvider, probeModelAvailability }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/auth-providers')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/auth-providers'),
    filename: require.resolve('../../../src/platforms/drivers/omp/auth-providers'),
    loaded: true,
    exports: {
      getCachedOmpAuthProviderSnapshot,
      getOmpAuthProviderCacheMeta,
      findAuthProviderForKey
    }
  };

  delete require.cache[require.resolve('../../../src/platforms/drivers/omp/api-channels')];
  routerFactory = require('../../../src/platforms/drivers/omp/api-channels');
});

afterEach(() => {
  [
    '../../../src/platforms/drivers/omp/api-channels',
    '../../../src/platforms/drivers/omp/channels-implementation',
    '../../../src/platforms/drivers/omp/sessions-implementation',
    '../../../src/server/services/channel-scheduler',
    '../../../src/server/services/channel-health',
    '../../../src/server/websocket-server',
    '../../../src/server/services/speed-test',
    '../../../src/server/services/model-detector',
    '../../../src/platforms/drivers/omp/auth-providers'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('omp-channels api', () => {
  test('lists all/enabled channels and reports install state with health', () => {
    let router = routerFactory({});
    let handler = findHandler(router, 'get', '/');
    let res = makeRes();
    handler({}, res);

    expect(res._body.channels).toHaveLength(2);
    expect(res._body.channels[0]).toEqual(expect.objectContaining({
      id: 'omp-1',
      providerKey: 'codex',
      health: { id: 'omp-1', healthy: true }
    }));
    expect(res._body.channels[0].ompAuthProvider).toEqual(expect.objectContaining({
      id: 'openai-codex',
      loggedIn: true,
      accountCount: 1
    }));
    expect(res._body.installed).toBe(true);
    expect(res._body.authProviderMeta).toEqual(expect.objectContaining({
      cached: true,
      stale: false,
      refreshing: false,
      fallback: false
    }));

    handler = findHandler(router, 'get', '/enabled');
    res = makeRes();
    handler({}, res);
    expect(res._body.channels).toHaveLength(1);
    expect(res._body.channels[0].id).toBe('omp-1');

    isOmpInstalled.mockReturnValue(false);
    delete require.cache[require.resolve('../../../src/platforms/drivers/omp/api-channels')];
    router = require('../../../src/platforms/drivers/omp/api-channels')({});
    handler = findHandler(router, 'get', '/');
    res = makeRes();
    handler({}, res);
    expect(res._body).toEqual({
      channels: [],
      installed: false,
      error: 'OMP CLI not installed',
      authProviderMeta: expect.objectContaining({
        fallback: true,
        refreshing: false,
        error: 'OMP CLI not installed'
      })
    });
  });

  test('reports auth-provider cold cache state without starting an auth refresh', () => {
    getCachedOmpAuthProviderSnapshot.mockReturnValueOnce(null);
    getOmpAuthProviderCacheMeta.mockReturnValueOnce({
      cached: false,
      stale: true,
      refreshing: true,
      fallback: true,
      checkedAt: null,
      error: null
    });

    const router = routerFactory({});
    const handler = findHandler(router, 'get', '/');
    const res = makeRes();
    handler({}, res);

    expect(res._body.channels).toHaveLength(2);
    expect(res._body.channels[0].ompAuthProvider).toBeUndefined();
    expect(res._body.authProviderMeta).toEqual(expect.objectContaining({
      cached: false,
      stale: true,
      refreshing: true,
      fallback: true
    }));
  });

  test('validates probing input and falls back to availability probing for channel models', async () => {
    const router = routerFactory({});

    let handler = findHandler(router, 'post', '/probe-models');
    let res = makeRes();
    await handler({ body: {} }, res);
    expect(res._status).toBe(400);

    res = makeRes();
    await handler({ body: { baseUrl: 'https://omp.new/v1', apiKey: 'secret', gatewaySourceType: 'opencode' } }, res);
    expect(fetchModelsFromProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Temporary OMP Channel',
        baseUrl: 'https://omp.new/v1',
        apiKey: 'secret',
        gatewaySourceType: 'opencode'
      }),
      'openai_compatible',
      expect.objectContaining({ useV1ModelsEndpoint: true, forceRefresh: false })
    );
    expect(res._body).toEqual({
      models: ['gpt-5'],
      supported: true,
      fallbackUsed: false,
      cached: false,
      stale: false,
      retryAfter: null,
      error: null,
      errorHint: null
    });

    fetchModelsFromProvider.mockResolvedValueOnce({
      models: [],
      cached: false,
      error: '未返回可用模型列表',
      errorHint: '请手动填写模型名称'
    });
    res = makeRes();
    await handler({
      body: {
        baseUrl: 'https://omp.new/v1',
        apiKey: 'secret',
        gatewaySourceType: 'openai_compatible',
        model: 'manual-model'
      }
    }, res);
    expect(probeModelAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Temporary OMP Channel',
        baseUrl: 'https://omp.new/v1',
        model: 'manual-model'
      }),
      'openai_compatible',
      expect.objectContaining({
        stopOnFirstAvailable: false,
        preferredModels: ['manual-model'],
        forceRefresh: false
      })
    );
    expect(res._body).toEqual({
      models: ['gpt-5', 'gpt-5-mini'],
      supported: true,
      fallbackUsed: true,
      cached: false,
      stale: false,
      retryAfter: null,
      error: null,
      errorHint: '模型列表接口不可用，已自动切换为模型探测结果'
    });

    res = makeRes();
    await handler({
      body: {
        baseUrl: 'https://omp.oauth/v1',
        authMode: 'oauth',
        providerKey: 'openai-codex',
        gatewaySourceType: 'openai_compatible',
        model: 'gpt-5',
        allowedModels: ['gpt-5-mini']
      }
    }, res);
    expect(res._body).toEqual({
      models: ['gpt-5', 'gpt-5-mini'],
      supported: true,
      fallbackUsed: true,
      cached: false,
      stale: false,
      retryAfter: null,
      error: null,
      errorHint: '请手动填写默认模型、测速模型或可用模型；运行时由 OMP 的登录凭证提供访问权限'
    });

    handler = findHandler(router, 'get', '/:channelId/models');
    res = makeRes();
    await handler({ params: { channelId: 'omp-1' }, query: {} }, res);
    expect(probeModelAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'omp-1' }),
      'codex',
      expect.objectContaining({
        stopOnFirstAvailable: false,
        preferredModels: ['gpt-5', 'gpt-5-mini']
      })
    );
    expect(res._body).toEqual(expect.objectContaining({
      channelId: 'omp-1',
      gatewaySourceType: 'codex',
      models: ['gpt-5', 'gpt-5-mini'],
      supported: true,
      fallbackUsed: true,
      error: null,
      errorHint: '模型列表接口不可用，已自动切换为模型探测结果'
    }));
  });

  test('returns cached OMP catalogs during backoff without probing models', async () => {
    fetchModelsFromProvider.mockResolvedValueOnce({
      models: ['gpt-5'],
      cached: true,
      stale: true,
      backoff: true,
      retryAfter: '2026-07-16T12:00:00.000Z',
      lastChecked: '2026-07-16T11:00:00.000Z',
      error: '访问被拒绝',
      errorHint: '请稍后重试'
    });
    const router = routerFactory({});
    const handler = findHandler(router, 'get', '/:channelId/models');
    const res = makeRes();

    await handler({ params: { channelId: 'omp-1' }, query: {} }, res);

    expect(probeModelAvailability).not.toHaveBeenCalled();
    expect(res._body).toEqual(expect.objectContaining({
      models: ['gpt-5'], cached: true, stale: true,
      retryAfter: '2026-07-16T12:00:00.000Z', error: '访问被拒绝'
    }));
  });

  test('only forces temporary OMP model discovery when requested by the client', async () => {
    const router = routerFactory({});
    const handler = findHandler(router, 'post', '/probe-models');
    const res = makeRes();

    await handler({
      body: {
        baseUrl: 'https://omp.new/v1',
        apiKey: 'secret',
        forceRefresh: true
      }
    }, res);

    expect(fetchModelsFromProvider).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://omp.new/v1' }),
      'openai_compatible',
      expect.objectContaining({ forceRefresh: true })
    );
  });

  test('web API sends unsaved channel model selections to metadata lookup', async () => {
    vi.resetModules();
    vi.doMock('../../../src/web/src/api/client.js', () => ({
      SPEED_TEST_API_TIMEOUT_MS: 180000,
      client: {
        post: vi.fn(async () => ({ data: { models: [] } }))
      }
    }));
    const { client } = await import('../../../src/web/src/api/client.js');
    const { fetchOmpCatalogMetadata } = await import('../../../src/web/src/api/channels.js');

    await fetchOmpCatalogMetadata('unregistered-provider', {
      model: 'gpt-5.6-sol',
      speedTestModel: 'gpt-5.6-luna',
      allowedModels: ['gpt-5.6-terra'],
      models: [{ id: 'gpt-5.6-sol', contextWindow: 1050000 }]
    });

    expect(client.post).toHaveBeenCalledWith('/omp/channels/catalog-metadata', {
      providerKey: 'unregistered-provider',
      forceRefresh: false,
      model: 'gpt-5.6-sol',
      speedTestModel: 'gpt-5.6-luna',
      allowedModels: ['gpt-5.6-terra'],
      models: [{ id: 'gpt-5.6-sol', contextWindow: 1050000 }]
    });
    vi.doUnmock('../../../src/web/src/api/client.js');
  });

  test('uses form model ids when OMP has not registered the provider yet', () => {
    const getOmpCatalogModels = vi.fn(() => [{ id: 'gpt-5.6-sol', contextWindow: 1050000 }]);
    const settingsManagerPath = require.resolve('../../../src/platforms/drivers/omp/native-config-implementation');
    require.cache[settingsManagerPath].exports.getOmpCatalogModels = getOmpCatalogModels;
    delete require.cache[require.resolve('../../../src/platforms/drivers/omp/api-channels')];
    const router = require('../../../src/platforms/drivers/omp/api-channels')({});
    const handler = findHandler(router, 'post', '/catalog-metadata');
    const res = makeRes();

    handler({ body: {
      providerKey: 'unregistered-provider',
      model: 'gpt-5.6-sol',
      allowedModels: ['gpt-5.6-terra'],
      models: [{ id: 'gpt-5.6-luna' }]
    } }, res);

    expect(getOmpCatalogModels).toHaveBeenCalledWith('unregistered-provider', expect.objectContaining({
      requestedModelIds: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
    }));
    expect(res._body.models).toEqual([
      expect.objectContaining({ id: 'gpt-5.6-sol', contextWindow: 1050000 })
    ]);
  });

  test('keeps OMP channel CRUD independent from model discovery', () => {
    const router = routerFactory({});
    const createHandler = findHandler(router, 'post', '/');
    const updateHandler = findHandler(router, 'put', '/:channelId');

    createHandler({ body: { name: 'New', baseUrl: 'https://new.omp/v1', apiKey: 'secret' } }, makeRes());
    updateHandler({ params: { channelId: 'omp-1' }, body: { name: 'Updated' } }, makeRes());

    expect(fetchModelsFromProvider).not.toHaveBeenCalled();
    expect(probeModelAvailability).not.toHaveBeenCalled();
  });

  test('rejects invalid model definitions without mutating the channel', () => {
    const router = routerFactory({});
    const createHandler = findHandler(router, 'post', '/');
    const res = makeRes();

    createHandler({
      body: {
        name: 'Invalid',
        baseUrl: 'https://invalid.example/v1',
        apiKey: 'secret',
        models: [{ id: 'duplicate' }, { id: 'DUPLICATE' }]
      }
    }, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toContain('duplicate model id');
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('creates keyless channels with an explicit OMP routing group', () => {
    const router = routerFactory({});
    const createHandler = findHandler(router, 'post', '/');
    const res = makeRes();

    createHandler({
      body: {
        name: 'Local OMP',
        baseUrl: 'http://127.0.0.1:11434/v1',
        providerKey: 'ollama',
        providerApi: 'openai-completions',
        authMode: 'none',
        routingGroup: 'local'
      }
    }, res);

    expect(res._status).toBe(200);
    expect(createChannel).toHaveBeenCalledWith(
      'Local OMP',
      'http://127.0.0.1:11434/v1',
      undefined,
      expect.objectContaining({
        authMode: 'none',
        oauthProviderId: '',
        routingGroup: 'local'
      })
    );
  });

  test('creates channels, saves order, tests speeds, and resets health', async () => {
    const router = routerFactory({});

    let handler = findHandler(router, 'post', '/');
    let res = makeRes();
    handler({
      body: {
        name: 'New OMP',
        baseUrl: 'https://new.omp/v1',
        apiKey: 'secret',
        wireApi: 'openai',
        providerApi: 'openai-responses',
        providerKey: 'new-omp',
        gatewaySourceType: 'claude',
        model: 'gpt-5',
        allowedModels: ['gpt-5', 'gpt-5-mini'],
        modelMetadataMode: 'manual',
        models: [{ id: 'gpt-5', contextWindow: 272000, maxTokens: 128000 }],
        providerConfig: { discovery: 'openai-models-list' },
        balanceToken: 'balance-session',
        balanceUserId: 8899
      }
    }, res);
    expect(createChannel).toHaveBeenCalledWith(
      'New OMP',
      'https://new.omp/v1',
      'secret',
      expect.objectContaining({
        wireApi: 'openai',
        providerApi: 'openai-responses',
        providerKey: 'new-omp',
        gatewaySourceType: 'claude',
        model: 'gpt-5',
        allowedModels: ['gpt-5', 'gpt-5-mini'],
        modelMetadataMode: 'manual',
        models: [{ id: 'gpt-5', contextWindow: 272000, maxTokens: 128000 }],
        providerConfig: { discovery: 'openai-models-list' },
        balanceToken: 'balance-session',
        balanceUserId: 8899
      })
    );
    expect(res._body).toEqual(expect.objectContaining({ id: 'omp-new' }));
    expect(broadcastSchedulerState).toHaveBeenCalledWith('omp', { queue: 0 });

    res = makeRes();
    handler({
      body: {
        name: 'OAuth OMP',
        baseUrl: 'https://oauth.omp/v1',
        authMode: 'oauth',
        providerKey: 'openai-codex',
        oauthProviderId: 'openai-codex',
        gatewaySourceType: 'openai_compatible',
        model: 'gpt-5'
      }
    }, res);
    expect(createChannel).toHaveBeenCalledWith(
      'OAuth OMP',
      'https://oauth.omp/v1',
      undefined,
      expect.objectContaining({
        authMode: 'oauth',
        oauthProviderId: 'openai-codex',
        providerKey: 'openai-codex',
        model: 'gpt-5'
      })
    );

    handler = findHandler(router, 'post', '/order');
    res = makeRes();
    handler({ body: { order: ['omp-2', 'omp-1'] } }, res);
    expect(saveChannelOrder).toHaveBeenCalledWith(['omp-2', 'omp-1']);

    handler = findHandler(router, 'post', '/:channelId/speed-test');
    res = makeRes();
    await handler({ params: { channelId: 'omp-1' }, body: { timeout: 8000 } }, res);
    expect(res._body).toEqual(expect.objectContaining({
      channelId: 'omp-1',
      timeout: 8000,
      gatewaySourceType: 'codex'
    }));

    handler = findHandler(router, 'post', '/speed-test-all');
    res = makeRes();
    await handler({ body: { timeout: 9000, concurrency: 4 } }, res);
    expect(res._body.summary).toEqual({
      total: 2,
      success: 1,
      failed: 1,
      avgLatency: 88,
      concurrency: 4
    });
    expect(testChannelSpeed).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'omp-1' }),
      8000,
      'codex',
      { authSourceType: 'omp' }
    );
    expect(testChannelSpeed).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'omp-1' }),
      9000,
      'codex',
      { authSourceType: 'omp' }
    );
    expect(testChannelSpeed).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: 'omp-2' }),
      9000,
      'gemini',
      { authSourceType: 'omp' }
    );

    handler = findHandler(router, 'post', '/:channelId/reset-health');
    res = makeRes();
    handler({ params: { channelId: 'omp-1' } }, res);
    expect(resetChannelHealth).toHaveBeenCalledWith('omp-1', 'omp');
    expect(res._body.success).toBe(true);
  });
});
