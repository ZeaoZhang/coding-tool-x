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
let getOmpAuthProviderSnapshot;
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
  getOmpAuthProviderSnapshot = vi.fn(() => ({
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
  findAuthProviderForKey = vi.fn((providerKey, snapshot) => {
    if (providerKey === 'codex') return snapshot.providers[0];
    return null;
  });
  isOmpInstalled = vi.fn(() => true);

  require.cache[require.resolve('../../../src/server/services/omp-channels')] = {
    id: require.resolve('../../../src/server/services/omp-channels'),
    filename: require.resolve('../../../src/server/services/omp-channels'),
    loaded: true,
    exports: {
      getChannels,
      createChannel,
      updateChannel,
      deleteChannel,
      saveChannelOrder
    }
  };
  require.cache[require.resolve('../../../src/server/services/omp-sessions')] = {
    id: require.resolve('../../../src/server/services/omp-sessions'),
    filename: require.resolve('../../../src/server/services/omp-sessions'),
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
  require.cache[require.resolve('../../../src/server/services/omp-auth-providers')] = {
    id: require.resolve('../../../src/server/services/omp-auth-providers'),
    filename: require.resolve('../../../src/server/services/omp-auth-providers'),
    loaded: true,
    exports: { getOmpAuthProviderSnapshot, findAuthProviderForKey }
  };

  delete require.cache[require.resolve('../../../src/server/api/omp-channels')];
  routerFactory = require('../../../src/server/api/omp-channels');
});

afterEach(() => {
  [
    '../../../src/server/api/omp-channels',
    '../../../src/server/services/omp-channels',
    '../../../src/server/services/omp-sessions',
    '../../../src/server/services/channel-scheduler',
    '../../../src/server/services/channel-health',
    '../../../src/server/websocket-server',
    '../../../src/server/services/speed-test',
    '../../../src/server/services/model-detector',
    '../../../src/server/services/omp-auth-providers'
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

    handler = findHandler(router, 'get', '/enabled');
    res = makeRes();
    handler({}, res);
    expect(res._body.channels).toHaveLength(1);
    expect(res._body.channels[0].id).toBe('omp-1');

    isOmpInstalled.mockReturnValue(false);
    delete require.cache[require.resolve('../../../src/server/api/omp-channels')];
    router = require('../../../src/server/api/omp-channels')({});
    handler = findHandler(router, 'get', '/');
    res = makeRes();
    handler({}, res);
    expect(res._body).toEqual({
      channels: [],
      installed: false,
      error: 'OMP CLI not installed'
    });
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
      expect.objectContaining({ useV1ModelsEndpoint: true, forceRefresh: true })
    );
    expect(res._body).toEqual({
      models: ['gpt-5'],
      supported: true,
      fallbackUsed: false,
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
        forceRefresh: true
      })
    );
    expect(res._body).toEqual({
      models: ['gpt-5', 'gpt-5-mini'],
      supported: true,
      fallbackUsed: true,
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
