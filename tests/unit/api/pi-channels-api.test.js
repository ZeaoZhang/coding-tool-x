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
let isPiInstalled;
let routerFactory;

beforeEach(() => {
  getChannels = vi.fn(() => ({
    channels: [
      {
        id: 'pi-1',
        name: 'Pi One',
        baseUrl: 'https://pi.one/v1',
        enabled: true,
        gatewaySourceType: 'codex',
        providerApi: 'openai-completions',
        model: 'gpt-5',
        allowedModels: ['gpt-5-mini']
      },
      {
        id: 'pi-2',
        name: 'Pi Two',
        baseUrl: 'https://pi.two/v1',
        enabled: false,
        gatewaySourceType: 'gemini',
        allowedModels: ['gemini-2.5-pro']
      }
    ]
  }));
  createChannel = vi.fn((name, baseUrl, apiKey, options) => ({
    id: 'pi-new',
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
    success: channel.id !== 'pi-2',
    latency: channel.id === 'pi-2' ? null : 88,
    timeout,
    gatewaySourceType: type
  }));
  sanitizeBatchConcurrency = vi.fn((value) => value || 2);
  runWithConcurrencyLimit = vi.fn(async (items, _concurrency, worker) => Promise.all(items.map(worker)));
  fetchModelsFromProvider = vi.fn(async (channel) => {
    if (channel.id === 'pi-1') {
      return { models: [], cached: false, lastChecked: '2026-01-01T00:00:00Z' };
    }
    return { models: ['gpt-5', 'gpt-5'], cached: false, lastChecked: '2026-01-02T00:00:00Z' };
  });
  probeModelAvailability = vi.fn(async () => ({
    availableModels: ['gpt-5', 'gpt-5-mini'],
    cached: false,
    lastChecked: '2026-01-03T00:00:00Z'
  }));
  isPiInstalled = vi.fn(() => true);

  require.cache[require.resolve('../../../src/server/services/pi-channels')] = {
    id: require.resolve('../../../src/server/services/pi-channels'),
    filename: require.resolve('../../../src/server/services/pi-channels'),
    loaded: true,
    exports: {
      getChannels,
      createChannel,
      updateChannel,
      deleteChannel,
      saveChannelOrder
    }
  };
  require.cache[require.resolve('../../../src/server/services/pi-sessions')] = {
    id: require.resolve('../../../src/server/services/pi-sessions'),
    filename: require.resolve('../../../src/server/services/pi-sessions'),
    loaded: true,
    exports: { isPiInstalled }
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

  delete require.cache[require.resolve('../../../src/server/api/pi-channels')];
  routerFactory = require('../../../src/server/api/pi-channels');
});

afterEach(() => {
  [
    '../../../src/server/api/pi-channels',
    '../../../src/server/services/pi-channels',
    '../../../src/server/services/pi-sessions',
    '../../../src/server/services/channel-scheduler',
    '../../../src/server/services/channel-health',
    '../../../src/server/websocket-server',
    '../../../src/server/services/speed-test',
    '../../../src/server/services/model-detector'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('pi-channels api', () => {
  test('lists all/enabled channels and reports install state with health', () => {
    let router = routerFactory({});
    let handler = findHandler(router, 'get', '/');
    let res = makeRes();
    handler({}, res);

    expect(res._body.channels).toHaveLength(2);
    expect(res._body.channels[0]).toEqual(expect.objectContaining({
      id: 'pi-1',
      health: { id: 'pi-1', healthy: true }
    }));
    expect(res._body.installed).toBe(true);

    handler = findHandler(router, 'get', '/enabled');
    res = makeRes();
    handler({}, res);
    expect(res._body.channels).toHaveLength(1);
    expect(res._body.channels[0].id).toBe('pi-1');

    isPiInstalled.mockReturnValue(false);
    delete require.cache[require.resolve('../../../src/server/api/pi-channels')];
    router = require('../../../src/server/api/pi-channels')({});
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
    await handler({ body: { baseUrl: 'https://pi.new/v1', apiKey: 'secret', gatewaySourceType: 'opencode' } }, res);
    expect(fetchModelsFromProvider).toHaveBeenCalledWith(
      { baseUrl: 'https://pi.new/v1', apiKey: 'secret', gatewaySourceType: 'opencode' },
      'opencode',
      expect.objectContaining({ useV1ModelsEndpoint: true, forceRefresh: true })
    );
    expect(res._body).toEqual({
      models: ['gpt-5'],
      supported: true,
      error: null,
      errorHint: null
    });

    handler = findHandler(router, 'get', '/:channelId/models');
    res = makeRes();
    await handler({ params: { channelId: 'pi-1' }, query: {} }, res);
    expect(probeModelAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pi-1' }),
      'codex',
      expect.objectContaining({
        stopOnFirstAvailable: false,
        preferredModels: ['gpt-5', 'gpt-5-mini']
      })
    );
    expect(res._body).toEqual(expect.objectContaining({
      channelId: 'pi-1',
      gatewaySourceType: 'codex',
      models: ['gpt-5', 'gpt-5-mini'],
      supported: true,
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
        name: 'New Pi',
        baseUrl: 'https://new.pi/v1',
        apiKey: 'secret',
        wireApi: 'openai',
        providerApi: 'openai-responses',
        providerKey: 'new-pi',
        gatewaySourceType: 'claude',
        model: 'gpt-5',
        balanceToken: 'balance-session',
        balanceUserId: 8899
      }
    }, res);
    expect(createChannel).toHaveBeenCalledWith(
      'New Pi',
      'https://new.pi/v1',
      'secret',
      expect.objectContaining({
        wireApi: 'openai',
        providerApi: 'openai-responses',
        providerKey: 'new-pi',
        gatewaySourceType: 'claude',
        model: 'gpt-5',
        balanceToken: 'balance-session',
        balanceUserId: 8899
      })
    );
    expect(res._body).toEqual(expect.objectContaining({ id: 'pi-new' }));
    expect(broadcastSchedulerState).toHaveBeenCalledWith('pi', { queue: 0 });

    handler = findHandler(router, 'post', '/order');
    res = makeRes();
    handler({ body: { order: ['pi-2', 'pi-1'] } }, res);
    expect(saveChannelOrder).toHaveBeenCalledWith(['pi-2', 'pi-1']);

    handler = findHandler(router, 'post', '/:channelId/speed-test');
    res = makeRes();
    await handler({ params: { channelId: 'pi-1' }, body: { timeout: 8000 } }, res);
    expect(res._body).toEqual(expect.objectContaining({
      channelId: 'pi-1',
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
      expect.objectContaining({ id: 'pi-1' }),
      8000,
      'codex',
      { authSourceType: 'pi' }
    );
    expect(testChannelSpeed).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'pi-1' }),
      9000,
      'codex',
      { authSourceType: 'pi' }
    );
    expect(testChannelSpeed).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: 'pi-2' }),
      9000,
      'gemini',
      { authSourceType: 'pi' }
    );

    handler = findHandler(router, 'post', '/:channelId/reset-health');
    res = makeRes();
    handler({ params: { channelId: 'pi-1' } }, res);
    expect(resetChannelHealth).toHaveBeenCalledWith('pi-1', 'pi');
    expect(res._body.success).toBe(true);
  });
});
