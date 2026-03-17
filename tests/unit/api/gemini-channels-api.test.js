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
let getEnabledChannels;
let getSchedulerState;
let getChannelHealthStatus;
let resetChannelHealth;
let testChannelSpeed;
let getLatencyLevel;
let sanitizeBatchConcurrency;
let runWithConcurrencyLimit;
let broadcastSchedulerState;
let clearGeminiRedirectCache;
let isGeminiInstalled;
let getDefaultSpeedTestModelByToolType;
let routerFactory;

beforeEach(() => {
  getChannels = vi.fn(() => ({
    channels: [
      { id: 'g-1', name: 'Gem One', baseUrl: 'https://gem.one', enabled: true },
      { id: 'g-2', name: 'Gem Two', baseUrl: 'https://gem.two', enabled: false }
    ]
  }));
  createChannel = vi.fn((name, baseUrl, apiKey, model, options) => ({
    id: 'gem-new', name, baseUrl, apiKey, model, ...options
  }));
  saveChannelOrder = vi.fn();
  getEnabledChannels = vi.fn(() => [{ id: 'g-1', enabled: true }]);
  getSchedulerState = vi.fn(() => ({ channels: 1 }));
  getChannelHealthStatus = vi.fn((id) => ({ id, healthy: true }));
  resetChannelHealth = vi.fn();
  testChannelSpeed = vi.fn(async (channel, timeout, type) => ({ channelId: channel.id, timeout, success: true, latency: channel.id === 'g-1' ? 50 : 100, type }));
  getLatencyLevel = vi.fn(() => 'fast');
  sanitizeBatchConcurrency = vi.fn((value) => value || 3);
  runWithConcurrencyLimit = vi.fn(async (items, concurrency, worker) => Promise.all(items.map(worker)));
  broadcastSchedulerState = vi.fn();
  clearGeminiRedirectCache = vi.fn();
  isGeminiInstalled = vi.fn(() => true);
  getDefaultSpeedTestModelByToolType = vi.fn(() => 'gemini-2.0-flash');

  require.cache[require.resolve('../../../src/server/services/gemini-channels')] = {
    id: require.resolve('../../../src/server/services/gemini-channels'),
    filename: require.resolve('../../../src/server/services/gemini-channels'),
    loaded: true,
    exports: {
      getChannels,
      createChannel,
      updateChannel: vi.fn(),
      deleteChannel: vi.fn(async () => ({ success: true })),
      getEnabledChannels,
      saveChannelOrder
    }
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
  require.cache[require.resolve('../../../src/server/services/gemini-config')] = {
    id: require.resolve('../../../src/server/services/gemini-config'),
    filename: require.resolve('../../../src/server/services/gemini-config'),
    loaded: true,
    exports: { isGeminiInstalled }
  };
  require.cache[require.resolve('../../../src/server/services/speed-test')] = {
    id: require.resolve('../../../src/server/services/speed-test'),
    filename: require.resolve('../../../src/server/services/speed-test'),
    loaded: true,
    exports: {
      testChannelSpeed,
      getLatencyLevel,
      sanitizeBatchConcurrency,
      runWithConcurrencyLimit
    }
  };
  require.cache[require.resolve('../../../src/server/gemini-proxy-server')] = {
    id: require.resolve('../../../src/server/gemini-proxy-server'),
    filename: require.resolve('../../../src/server/gemini-proxy-server'),
    loaded: true,
    exports: { clearGeminiRedirectCache }
  };
  require.cache[require.resolve('../../../src/config/model-metadata')] = {
    id: require.resolve('../../../src/config/model-metadata'),
    filename: require.resolve('../../../src/config/model-metadata'),
    loaded: true,
    exports: { getDefaultSpeedTestModelByToolType }
  };

  delete require.cache[require.resolve('../../../src/server/api/gemini-channels')];
  routerFactory = require('../../../src/server/api/gemini-channels');
});

afterEach(() => {
  [
    '../../../src/server/api/gemini-channels',
    '../../../src/server/services/gemini-channels',
    '../../../src/server/services/channel-scheduler',
    '../../../src/server/services/channel-health',
    '../../../src/server/websocket-server',
    '../../../src/server/services/gemini-config',
    '../../../src/server/services/speed-test',
    '../../../src/server/gemini-proxy-server',
    '../../../src/config/model-metadata'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('gemini-channels api', () => {
  test('lists channels with health and returns defaults when not installed', () => {
    let router = routerFactory({});
    let handler = findHandler(router, 'get', '/');
    let res = makeRes();
    handler({}, res);
    expect(res._body.channels[0].health).toEqual({ id: 'g-1', healthy: true });

    isGeminiInstalled.mockReturnValue(false);
    delete require.cache[require.resolve('../../../src/server/api/gemini-channels')];
    router = require('../../../src/server/api/gemini-channels')({});
    handler = findHandler(router, 'get', '/');
    res = makeRes();
    handler({}, res);
    expect(res._body).toEqual({ channels: [], error: 'Gemini CLI not installed' });
  });

  test('returns default models, creates channels, saves order, and lists enabled channels', async () => {
    const router = routerFactory({});

    let handler = findHandler(router, 'get', '/:id/models');
    let res = makeRes();
    await handler({ params: { id: 'g-1' } }, res);
    expect(res._body.models).toEqual(['gemini-2.0-flash']);

    handler = findHandler(router, 'post', '/');
    res = makeRes();
    handler({ body: { name: 'New Gem', baseUrl: 'https://new.gem', apiKey: 'secret' } }, res);
    expect(res._body).toEqual(expect.objectContaining({
      id: 'gem-new',
      model: 'gemini-2.0-flash'
    }));

    handler = findHandler(router, 'post', '/order');
    res = makeRes();
    handler({ body: { order: ['g-2', 'g-1'] } }, res);
    expect(saveChannelOrder).toHaveBeenCalledWith(['g-2', 'g-1']);

    handler = findHandler(router, 'get', '/enabled');
    res = makeRes();
    handler({}, res);
    expect(res._body).toEqual({ channels: [{ id: 'g-1', enabled: true }] });
  });

  test('speed-test-all builds summary and reset-health returns latest health', async () => {
    const router = routerFactory({});

    let handler = findHandler(router, 'post', '/speed-test-all');
    let res = makeRes();
    await handler({ body: { timeout: 7000, concurrency: 5 } }, res);
    expect(res._body.summary).toEqual({
      total: 2,
      success: 2,
      failed: 0,
      avgLatency: 75,
      concurrency: 5
    });

    handler = findHandler(router, 'post', '/:channelId/reset-health');
    res = makeRes();
    handler({ params: { channelId: 'g-1' } }, res);
    expect(resetChannelHealth).toHaveBeenCalledWith('g-1', 'gemini');
    expect(res._body).toEqual({
      success: true,
      message: '渠道健康状态已重置',
      health: { id: 'g-1', healthy: true }
    });
  });
});
