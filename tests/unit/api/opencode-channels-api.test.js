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
let saveChannelOrder;
let getSchedulerState;
let getChannelHealthStatus;
let resetChannelHealth;
let broadcastSchedulerState;
let testChannelSpeed;
let sanitizeBatchConcurrency;
let runWithConcurrencyLimit;
let clearOpenCodeRedirectCache;
let fetchModelsFromProvider;
let probeModelAvailability;
let isOpenCodeInstalled;
let routerFactory;

beforeEach(() => {
  getChannels = vi.fn(() => ({
    channels: [
      { id: 'o-1', name: 'Open One', baseUrl: 'https://open.one', enabled: true, gatewaySourceType: 'codex', model: 'gpt-4.1' },
      { id: 'o-2', name: 'Open Two', baseUrl: 'https://open.two', enabled: false, gatewaySourceType: 'gemini', allowedModels: ['gemini-2.0'] }
    ]
  }));
  createChannel = vi.fn((name, baseUrl, apiKey, options) => ({
    id: 'open-new',
    name,
    baseUrl,
    apiKey,
    ...options
  }));
  saveChannelOrder = vi.fn();
  getSchedulerState = vi.fn(() => ({ queue: 0 }));
  getChannelHealthStatus = vi.fn((id) => ({ id, healthy: true }));
  resetChannelHealth = vi.fn();
  broadcastSchedulerState = vi.fn();
  testChannelSpeed = vi.fn(async (channel, timeout, type) => ({
    channelId: channel.id,
    success: channel.id !== 'o-2',
    latency: channel.id === 'o-2' ? null : 120,
    timeout,
    gatewaySourceType: type
  }));
  sanitizeBatchConcurrency = vi.fn((value) => value || 2);
  runWithConcurrencyLimit = vi.fn(async (items, concurrency, worker) => Promise.all(items.map(worker)));
  clearOpenCodeRedirectCache = vi.fn();
  fetchModelsFromProvider = vi.fn(async (channel) => {
    if (!channel.id || channel.id === 'o-1') {
      return { models: [], disabledByConfig: true, cached: false, lastChecked: '2025-01-01T00:00:00Z' };
    }
    return { models: ['gemini-2.0'], cached: true, lastChecked: '2025-01-02T00:00:00Z' };
  });
  probeModelAvailability = vi.fn(async () => ({
    availableModels: ['gpt-4.1', 'gpt-4.1-mini'],
    cached: false,
    lastChecked: '2025-01-03T00:00:00Z'
  }));
  isOpenCodeInstalled = vi.fn(() => true);

  require.cache[require.resolve('../../../src/platforms/drivers/opencode/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/channels-implementation'),
    loaded: true,
    exports: {
      getChannels,
      createChannel,
      updateChannel: vi.fn(),
      deleteChannel: vi.fn(async () => ({ success: true })),
      saveChannelOrder
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/opencode/sessions-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/sessions-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/sessions-implementation'),
    loaded: true,
    exports: { isOpenCodeInstalled }
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
  require.cache[require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation'),
    loaded: true,
    exports: { clearOpenCodeRedirectCache }
  };
  require.cache[require.resolve('../../../src/server/services/model-detector')] = {
    id: require.resolve('../../../src/server/services/model-detector'),
    filename: require.resolve('../../../src/server/services/model-detector'),
    loaded: true,
    exports: { fetchModelsFromProvider, probeModelAvailability }
  };

  delete require.cache[require.resolve('../../../src/server/api/opencode-channels')];
  routerFactory = require('../../../src/server/api/opencode-channels');
});

afterEach(() => {
  [
    '../../../src/server/api/opencode-channels',
    '../../../src/platforms/drivers/opencode/channels-implementation',
    '../../../src/platforms/drivers/opencode/sessions-implementation',
    '../../../src/server/services/channel-scheduler',
    '../../../src/server/services/channel-health',
    '../../../src/server/websocket-server',
    '../../../src/server/services/speed-test',
    '../../../src/platforms/drivers/opencode/proxy-implementation',
    '../../../src/server/services/model-detector'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('opencode-channels api', () => {
  test('lists all/enabled channels and includes install state and health', () => {
    let router = routerFactory({});
    let handler = findHandler(router, 'get', '/');
    let res = makeRes();
    handler({}, res);
    expect(res._body).toEqual({
      channels: [
        { id: 'o-1', name: 'Open One', baseUrl: 'https://open.one', enabled: true, gatewaySourceType: 'codex', model: 'gpt-4.1', health: { id: 'o-1', healthy: true } },
        { id: 'o-2', name: 'Open Two', baseUrl: 'https://open.two', enabled: false, gatewaySourceType: 'gemini', allowedModels: ['gemini-2.0'], health: { id: 'o-2', healthy: true } }
      ],
      installed: true
    });

    handler = findHandler(router, 'get', '/enabled');
    res = makeRes();
    handler({}, res);
    expect(res._body.channels).toHaveLength(1);

    isOpenCodeInstalled.mockReturnValue(false);
    delete require.cache[require.resolve('../../../src/server/api/opencode-channels')];
    router = require('../../../src/server/api/opencode-channels')({});
    handler = findHandler(router, 'get', '/');
    res = makeRes();
    handler({}, res);
    expect(res._body.installed).toBe(false);
  });

  test('probe-models and channel models endpoints validate and use fallback probing', async () => {
    const router = routerFactory({});

    let handler = findHandler(router, 'post', '/probe-models');
    let res = makeRes();
    await handler({ body: {} }, res);
    expect(res._status).toBe(400);

    res = makeRes();
    await handler({ body: { baseUrl: 'https://open.one', apiKey: 'secret', gatewaySourceType: 'codex' } }, res);
    expect(res._body).toEqual({
      models: [],
      supported: false,
      error: '未返回可用模型列表',
      errorHint: '请手动填写模型名称'
    });

    handler = findHandler(router, 'get', '/:channelId/models');
    res = makeRes();
    await handler({ params: { channelId: 'o-1' }, query: {} }, res);
    expect(probeModelAvailability).toHaveBeenCalled();
    expect(res._body).toEqual(expect.objectContaining({
      channelId: 'o-1',
      gatewaySourceType: 'codex',
      models: ['gpt-4.1', 'gpt-4.1-mini'],
      supported: true
    }));
  });

  test('creates channels, saves order, tests all speeds, and resets health', async () => {
    const router = routerFactory({});

    let handler = findHandler(router, 'post', '/');
    let res = makeRes();
    handler({ body: { name: 'New Open', baseUrl: 'https://new.open', apiKey: 'secret', model: 'gpt-5', balanceToken: 'balance-session', balanceUserId: 8899 } }, res);
    expect(res._body).toEqual(expect.objectContaining({
      id: 'open-new',
      model: 'gpt-5',
      balanceToken: 'balance-session',
      balanceUserId: 8899
    }));

    handler = findHandler(router, 'post', '/order');
    res = makeRes();
    handler({ body: { order: ['o-2', 'o-1'] } }, res);
    expect(saveChannelOrder).toHaveBeenCalledWith(['o-2', 'o-1']);

    handler = findHandler(router, 'post', '/speed-test-all');
    res = makeRes();
    await handler({ body: { timeout: 9000, concurrency: 4 } }, res);
    expect(res._body.summary).toEqual({
      total: 2,
      success: 1,
      failed: 1,
      avgLatency: 120,
      concurrency: 4
    });

    handler = findHandler(router, 'post', '/:channelId/reset-health');
    res = makeRes();
    handler({ params: { channelId: 'o-1' } }, res);
    expect(resetChannelHealth).toHaveBeenCalledWith('o-1', 'opencode');
    expect(res._body.success).toBe(true);
  });
});
