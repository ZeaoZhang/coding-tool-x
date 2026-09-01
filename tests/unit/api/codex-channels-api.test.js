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
let saveChannelOrder;
let getEnabledChannels;
let applyChannelToSettings;
let getSchedulerState;
let getChannelHealthStatus;
let resetChannelHealth;
let testChannelSpeed;
let getLatencyLevel;
let sanitizeBatchConcurrency;
let runWithConcurrencyLimit;
let broadcastSchedulerState;
let broadcastLog;
let clearCodexRedirectCache;
let getCodexProxyStatus;
let stopCodexProxyServer;
let deleteBackup;
let isCodexInstalled;
let getDefaultSpeedTestModelByToolType;
let routerFactory;
let runtimeDriver;

beforeEach(() => {
  getChannels = vi.fn(() => ({
    channels: [
      { id: 'ch-1', name: 'Primary', providerKey: 'provider-a', baseUrl: 'https://api.example.com', apiKey: 'secret-a', requiresOpenaiAuth: false, enabled: true },
      { id: 'ch-2', name: 'Secondary', providerKey: 'provider-b', baseUrl: 'https://api2.example.com', apiKey: 'secret-b', requiresOpenaiAuth: false, enabled: false }
    ]
  }));
  createChannel = vi.fn((name, providerKey, baseUrl, apiKey, wireApi, options) => ({
    id: 'new-channel',
    name,
    providerKey,
    baseUrl,
    apiKey,
    wireApi,
    ...options
  }));
  updateChannel = vi.fn((id, updates) => ({
    id,
    ...updates
  }));
  saveChannelOrder = vi.fn();
  getEnabledChannels = vi.fn(() => [{ id: 'ch-1', enabled: true }]);
  applyChannelToSettings = vi.fn((id) => ({ id, name: 'Primary' }));
  getSchedulerState = vi.fn(() => ({ channels: 2 }));
  getChannelHealthStatus = vi.fn((id) => ({ id, available: true }));
  resetChannelHealth = vi.fn();
  testChannelSpeed = vi.fn(async (channel, timeout, type) => ({ channelId: channel.id, timeout, success: channel.id !== 'ch-2', latency: channel.id === 'ch-2' ? null : 80, type }));
  getLatencyLevel = vi.fn(() => 'fast');
  sanitizeBatchConcurrency = vi.fn((value) => value || 2);
  runWithConcurrencyLimit = vi.fn(async (items, concurrency, worker) => Promise.all(items.map(worker)));
  broadcastSchedulerState = vi.fn();
  broadcastLog = vi.fn();
  clearCodexRedirectCache = vi.fn();
  getCodexProxyStatus = vi.fn(() => ({ running: true }));
  stopCodexProxyServer = vi.fn(async () => {});
  deleteBackup = vi.fn();
  isCodexInstalled = vi.fn(() => true);
  runtimeDriver = {
    applyChannelToSettings,
    getChannels,
    getEnabledChannels,
    createChannel,
    updateChannel,
    saveChannelOrder
  };
  getDefaultSpeedTestModelByToolType = vi.fn(() => 'gpt-5-codex');

  require.cache[require.resolve('../../../src/server/services/codex-channels')] = {
    id: require.resolve('../../../src/server/services/codex-channels'),
    filename: require.resolve('../../../src/server/services/codex-channels'),
    loaded: true,
    exports: {
      getChannels,
      createChannel,
      updateChannel,
      deleteChannel: vi.fn(async () => ({ success: true })),
      getEnabledChannels,
      saveChannelOrder,
      applyChannelToSettings
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
    exports: {
      getChannelHealthStatus,
      resetChannelHealth
    }
  };
  require.cache[require.resolve('../../../src/server/websocket-server')] = {
    id: require.resolve('../../../src/server/websocket-server'),
    filename: require.resolve('../../../src/server/websocket-server'),
    loaded: true,
    exports: { broadcastSchedulerState, broadcastLog }
  };
  require.cache[require.resolve('../../../src/server/services/codex-config')] = {
    id: require.resolve('../../../src/server/services/codex-config'),
    filename: require.resolve('../../../src/server/services/codex-config'),
    loaded: true,
    exports: { isCodexInstalled }
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
  require.cache[require.resolve('../../../src/server/codex-proxy-server')] = {
    id: require.resolve('../../../src/server/codex-proxy-server'),
    filename: require.resolve('../../../src/server/codex-proxy-server'),
    loaded: true,
    exports: {
      clearCodexRedirectCache,
      getCodexProxyStatus,
      stopCodexProxyServer
    }
  };
  require.cache[require.resolve('../../../src/server/services/codex-settings-manager')] = {
    id: require.resolve('../../../src/server/services/codex-settings-manager'),
    filename: require.resolve('../../../src/server/services/codex-settings-manager'),
    loaded: true,
    exports: { deleteBackup }
  };
  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: { PATHS: { activeChannel: { codex: '/tmp/codex-active-channel.json' } } }
  };
  const runtimePath = require.resolve('../../../src/platforms/runtime');
  require.cache[runtimePath] = {
    id: runtimePath, filename: runtimePath, loaded: true,
    exports: {
      getPlatformRuntime: () => ({
        getDriver: (_platform, capability) => capability === 'channels'
          ? runtimeDriver
          : capability === 'proxy'
            ? { status: getCodexProxyStatus, stop: stopCodexProxyServer }
            : { deleteBackup, clearActiveChannelMarker: vi.fn() }
      })
    }
  };
  require.cache[require.resolve('../../../src/config/model-metadata')] = {
    id: require.resolve('../../../src/config/model-metadata'),
    filename: require.resolve('../../../src/config/model-metadata'),
    loaded: true,
    exports: { getDefaultSpeedTestModelByToolType }
  };

  delete require.cache[require.resolve('../../../src/server/api/codex-channels')];
  routerFactory = require('../../../src/server/api/codex-channels');
});

afterEach(() => {
  [
    '../../../src/server/api/codex-channels',
    '../../../src/server/services/codex-channels',
    '../../../src/server/services/channel-scheduler',
    '../../../src/server/services/channel-health',
    '../../../src/server/websocket-server',
    '../../../src/server/services/codex-config',
    '../../../src/server/services/speed-test',
    '../../../src/server/codex-proxy-server',
    '../../../src/server/services/codex-settings-manager',
    '../../../src/config/paths',
    '../../../src/config/model-metadata',
    '../../../src/platforms/runtime'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('codex-channels api', () => {
  test('lists channels with health and returns empty list when not installed', () => {
    let router = routerFactory({});
    let handler = findHandler(router, 'get', '/');
    let res = makeRes();
    handler({}, res);
    expect(res._body.channels[0].health).toEqual({ id: 'ch-1', available: true });

    isCodexInstalled.mockReturnValue(false);
    delete require.cache[require.resolve('../../../src/server/api/codex-channels')];
    router = require('../../../src/server/api/codex-channels')({});
    handler = findHandler(router, 'get', '/');
    res = makeRes();
    handler({}, res);
    expect(res._body).toEqual({ channels: [], error: 'Codex CLI not installed' });
  });

  test('returns default models and validates channel existence', async () => {
    const router = routerFactory({});
    const handler = findHandler(router, 'get', '/:id/models');

    let res = makeRes();
    await handler({ params: { id: 'missing' } }, res);
    expect(res._status).toBe(404);

    res = makeRes();
    await handler({ params: { id: 'ch-1' } }, res);
    expect(res._body).toEqual(expect.objectContaining({
      channelId: 'ch-1',
      models: ['gpt-5-codex'],
      gatewaySourceType: 'codex'
    }));
  });

  test('creates channel, saves order, tests all speed, applies settings, and resets health', async () => {
    const router = routerFactory({});

    let handler = findHandler(router, 'post', '/');
    let res = makeRes();
    handler({ body: { name: 'New', providerKey: 'provider-x', baseUrl: 'https://new.example.com', apiKey: 'secret', balanceToken: 'balance-session', balanceUserId: 8899 } }, res);
    expect(res._body).toEqual(expect.objectContaining({
      id: 'new-channel',
      wireApi: 'responses'
    }));
    expect(createChannel).toHaveBeenCalledWith(
      'New',
      'provider-x',
      'https://new.example.com',
      'secret',
      'responses',
      expect.objectContaining({ requiresOpenaiAuth: false, balanceToken: 'balance-session', balanceUserId: 8899 })
    );

    handler = findHandler(router, 'post', '/order');
    res = makeRes();
    handler({ body: { order: ['ch-2', 'ch-1'] } }, res);
    expect(saveChannelOrder).toHaveBeenCalledWith(['ch-2', 'ch-1']);

    handler = findHandler(router, 'post', '/speed-test-all');
    res = makeRes();
    await handler({ body: { timeout: 5000, concurrency: 4 } }, res);
    expect(res._body.summary).toEqual({
      total: 2,
      success: 1,
      failed: 1,
      avgLatency: 80,
      concurrency: 4
    });

    handler = findHandler(router, 'post', '/:channelId/apply-to-settings');
    res = makeRes();
    await handler({ params: { channelId: 'ch-1' } }, res);
    expect(applyChannelToSettings).toHaveBeenCalledWith('ch-1');
    expect(stopCodexProxyServer).toHaveBeenCalledWith({ clearStartTime: false });
    expect(deleteBackup).toHaveBeenCalled();

    handler = findHandler(router, 'post', '/:channelId/reset-health');
    res = makeRes();
    handler({ params: { channelId: 'ch-1' } }, res);
    expect(resetChannelHealth).toHaveBeenCalledWith('ch-1', 'codex');
    expect(res._body.success).toBe(true);
  });

  test('rejects Codex channel creation without API key even when auth mode is requested', () => {
    const router = routerFactory({});
    const handler = findHandler(router, 'post', '/');
    const res = makeRes();

    handler({
      body: {
        name: 'OpenAI Login',
        providerKey: 'provider-login',
        baseUrl: 'https://api.openai.com/v1',
        requiresOpenaiAuth: true
      }
    }, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Missing required fields: apiKey');
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('rejects updating a Codex channel to API key auth without providing an API key', () => {
    getChannels.mockReturnValue({
      channels: [
        {
          id: 'ch-oauth',
          name: 'OpenAI Login',
          providerKey: 'provider-login',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          requiresOpenaiAuth: true,
          enabled: true
        }
      ]
    });

    const router = routerFactory({});
    const handler = findHandler(router, 'put', '/:channelId');
    const res = makeRes();

    handler({
      params: { channelId: 'ch-oauth' },
      body: {
        requiresOpenaiAuth: false,
        apiKey: ''
      }
    }, res);

    expect(res._status).toBe(400);
    expect(updateChannel).not.toHaveBeenCalled();
  });

  test('rejects reserved openai providerKey on create', () => {
    const router = routerFactory({});
    const handler = findHandler(router, 'post', '/');
    const res = makeRes();

    handler({
      body: {
        name: 'OpenAI Reserved',
        providerKey: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret'
      }
    }, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/reserved/i);
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('returns 404 when updating a missing channel', () => {
    updateChannel.mockImplementation(() => {
      throw new Error('Channel not found');
    });

    const router = routerFactory({});
    const handler = findHandler(router, 'put', '/:channelId');
    const res = makeRes();

    handler({
      params: { channelId: 'missing-channel' },
      body: { enabled: false }
    }, res);

    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Channel not found' });
    expect(clearCodexRedirectCache).not.toHaveBeenCalled();
    expect(broadcastSchedulerState).not.toHaveBeenCalled();
  });
});
