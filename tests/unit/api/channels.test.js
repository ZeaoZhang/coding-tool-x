/**
 * Tests for src/server/api/channels.js
 *
 * Pattern: inject vi.fn() stubs into require.cache before requiring the module
 * under test. Mirrors the channel-scheduler.test.js pattern used in this project.
 */

const CHANNELS_SVC_PATH   = require.resolve('../../../src/server/services/channels');
const SCHEDULER_PATH      = require.resolve('../../../src/server/services/channel-scheduler');
const CHANNEL_HEALTH_PATH = require.resolve('../../../src/server/services/channel-health');
const SPEED_TEST_PATH     = require.resolve('../../../src/server/services/speed-test');
const PATHS_PATH          = require.resolve('../../../src/config/paths');
const SETTINGS_MGR_PATH   = require.resolve('../../../src/server/services/settings-manager');
const MODEL_META_PATH     = require.resolve('../../../src/config/model-metadata');
const WS_SERVER_PATH      = require.resolve('../../../src/server/websocket-server');
const PROXY_SERVER_PATH   = require.resolve('../../../src/server/proxy-server');
const NATIVE_OAUTH_PATH   = require.resolve('../../../src/server/services/native-oauth-adapters');
const API_PATH            = require.resolve('../../../src/server/api/channels');

// Stable stub references – recreated in beforeEach
let getAllChannels;
let applyChannelToSettings;
let createChannel;
let updateChannel;
let deleteChannel;
let getCurrentSettings;
let getBestChannelForRestore;
let updateClaudeSettingsWithModelConfig;
let getSchedulerState;
let getChannelHealthStatus;
let getAllChannelHealthStatus;
let resetChannelHealth;
let testChannelSpeed;
let getLatencyLevel;
let sanitizeBatchConcurrency;
let runWithConcurrencyLimit;
let deleteBackup;
let isProxyConfig;
let getDefaultSpeedTestModelByToolType;
let broadcastLog;
let broadcastProxyState;
let broadcastSchedulerState;
let clearRedirectCache;
let getProxyStatus;
let stopProxyServer;
let clearNativeOAuth;

let router;

function injectStubs() {
  getAllChannels                    = vi.fn(() => []);
  applyChannelToSettings           = vi.fn();
  createChannel                    = vi.fn();
  updateChannel                    = vi.fn();
  deleteChannel                    = vi.fn();
  getCurrentSettings               = vi.fn(() => null);
  getBestChannelForRestore         = vi.fn(() => null);
  updateClaudeSettingsWithModelConfig = vi.fn();
  getSchedulerState                = vi.fn(() => ({ channels: [], pending: 0 }));
  getChannelHealthStatus           = vi.fn(() => ({ available: true }));
  getAllChannelHealthStatus         = vi.fn(() => ({}));
  resetChannelHealth               = vi.fn();
  testChannelSpeed                 = vi.fn(async () => ({ success: true, latency: 100 }));
  getLatencyLevel                  = vi.fn(() => 'fast');
  sanitizeBatchConcurrency         = vi.fn((c) => c || 3);
  runWithConcurrencyLimit          = vi.fn(async (items, _, fn) => Promise.all(items.map(fn)));
  deleteBackup                     = vi.fn();
  isProxyConfig                    = vi.fn(() => false);
  getDefaultSpeedTestModelByToolType = vi.fn(() => 'claude-haiku-4-5');
  broadcastLog                     = vi.fn();
  broadcastProxyState              = vi.fn();
  broadcastSchedulerState          = vi.fn();
  clearRedirectCache               = vi.fn();
  getProxyStatus                   = vi.fn(() => null);
  stopProxyServer                  = vi.fn(async () => {});
  clearNativeOAuth                 = vi.fn();

  require.cache[CHANNELS_SVC_PATH] = {
    id: CHANNELS_SVC_PATH, filename: CHANNELS_SVC_PATH, loaded: true,
    exports: { getAllChannels, applyChannelToSettings, createChannel, updateChannel, deleteChannel, getCurrentSettings, getBestChannelForRestore, updateClaudeSettingsWithModelConfig }
  };
  require.cache[SCHEDULER_PATH] = {
    id: SCHEDULER_PATH, filename: SCHEDULER_PATH, loaded: true,
    exports: { getSchedulerState }
  };
  require.cache[CHANNEL_HEALTH_PATH] = {
    id: CHANNEL_HEALTH_PATH, filename: CHANNEL_HEALTH_PATH, loaded: true,
    exports: { getChannelHealthStatus, getAllChannelHealthStatus, resetChannelHealth }
  };
  require.cache[SPEED_TEST_PATH] = {
    id: SPEED_TEST_PATH, filename: SPEED_TEST_PATH, loaded: true,
    exports: { testChannelSpeed, getLatencyLevel, sanitizeBatchConcurrency, runWithConcurrencyLimit }
  };
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
    exports: { PATHS: { activeChannel: { claude: '/tmp/test-active-channel.json' } } }
  };
  require.cache[SETTINGS_MGR_PATH] = {
    id: SETTINGS_MGR_PATH, filename: SETTINGS_MGR_PATH, loaded: true,
    exports: { deleteBackup, isProxyConfig }
  };
  require.cache[MODEL_META_PATH] = {
    id: MODEL_META_PATH, filename: MODEL_META_PATH, loaded: true,
    exports: { getDefaultSpeedTestModelByToolType }
  };
  require.cache[WS_SERVER_PATH] = {
    id: WS_SERVER_PATH, filename: WS_SERVER_PATH, loaded: true,
    exports: { broadcastLog, broadcastProxyState, broadcastSchedulerState }
  };
  require.cache[PROXY_SERVER_PATH] = {
    id: PROXY_SERVER_PATH, filename: PROXY_SERVER_PATH, loaded: true,
    exports: { clearRedirectCache, getProxyStatus, stopProxyServer }
  };
  require.cache[NATIVE_OAUTH_PATH] = {
    id: NATIVE_OAUTH_PATH, filename: NATIVE_OAUTH_PATH, loaded: true,
    exports: { clearNativeOAuth }
  };
}

function findHandler(router, method, routePath) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) {
      for (const routeLayer of layer.route.stack) {
        if (routeLayer.method === method) {
          return routeLayer.handle;
        }
      }
    }
  }
  return null;
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

beforeEach(() => {
  delete require.cache[API_PATH];
  injectStubs();
  router = require('../../../src/server/api/channels');
});

afterEach(() => {
  delete require.cache[API_PATH];
});

// ── GET / ──────────────────────────────────────────────────────────────────
describe('GET / - list channels with health', () => {
  it('returns channels array with health status attached', () => {
    const ch = { id: 'ch1', name: 'Test', baseUrl: 'http://api', apiKey: 'key1' };
    getAllChannels.mockReturnValue([ch]);
    getChannelHealthStatus.mockReturnValue({ available: true });

    const handler = findHandler(router, 'get', '/');
    const res = makeRes();
    handler({}, res);

    expect(res._body.channels).toHaveLength(1);
    expect(res._body.channels[0].health).toEqual({ available: true });
    expect(getChannelHealthStatus).toHaveBeenCalledWith('ch1');
  });

  it('returns empty channels when no channels exist', () => {
    const handler = findHandler(router, 'get', '/');
    const res = makeRes();
    handler({}, res);

    expect(res._body).toEqual({ channels: [] });
  });

  it('returns 500 when getAllChannels throws', () => {
    getAllChannels.mockImplementation(() => { throw new Error('storage error'); });

    const handler = findHandler(router, 'get', '/');
    const res = makeRes();
    handler({}, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('storage error');
  });
});

// ── GET /current ───────────────────────────────────────────────────────────
describe('GET /current - current settings', () => {
  it('returns matched channel and settings when settings exist', () => {
    const ch = { id: 'ch1', name: 'Test', baseUrl: 'http://api', apiKey: 'key1' };
    const settings = { baseUrl: 'http://api', apiKey: 'key1' };
    getAllChannels.mockReturnValue([ch]);
    getCurrentSettings.mockReturnValue(settings);

    const handler = findHandler(router, 'get', '/current');
    const res = makeRes();
    handler({}, res);

    expect(res._body.channel).toEqual(ch);
    expect(res._body.settings).toEqual(settings);
  });

  it('returns channel:null and settings:null when no settings', () => {
    const handler = findHandler(router, 'get', '/current');
    const res = makeRes();
    handler({}, res);

    expect(res._body.channel).toBeNull();
    expect(res._body.settings).toBeNull();
  });
});

// ── POST / ─────────────────────────────────────────────────────────────────
describe('POST / - create channel', () => {
  it('returns 400 when name is missing', () => {
    const handler = findHandler(router, 'post', '/');
    const req = { body: { baseUrl: 'http://api', apiKey: 'key1' } };
    const res = makeRes();
    handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/name/);
  });

  it('returns 400 when baseUrl is missing', () => {
    const handler = findHandler(router, 'post', '/');
    const req = { body: { name: 'Test', apiKey: 'key1' } };
    const res = makeRes();
    handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/baseUrl/);
  });

  it('returns 400 when apiKey is missing', () => {
    const handler = findHandler(router, 'post', '/');
    const req = { body: { name: 'Test', baseUrl: 'http://api' } };
    const res = makeRes();
    handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/apiKey/);
  });

  it('creates channel with valid data', () => {
    const created = { id: 'ch-new', name: 'New', baseUrl: 'http://api', apiKey: 'key1' };
    createChannel.mockReturnValue(created);

    const handler = findHandler(router, 'post', '/');
    const req = { body: { name: 'New', baseUrl: 'http://api', apiKey: 'key1' } };
    const res = makeRes();
    handler(req, res);

    expect(res._body.channel).toEqual(created);
    expect(createChannel).toHaveBeenCalledWith('New', 'http://api', 'key1', undefined, expect.any(Object));
    expect(broadcastSchedulerState).toHaveBeenCalled();
  });
});

// ── PUT /:id ───────────────────────────────────────────────────────────────
describe('PUT /:id - update channel', () => {
  it('returns updated channel on valid update', () => {
    const updated = { id: 'ch1', name: 'Updated', baseUrl: 'http://api', apiKey: 'key1' };
    updateChannel.mockReturnValue(updated);

    const handler = findHandler(router, 'put', '/:id');
    const req = { params: { id: 'ch1' }, body: { name: 'Updated' } };
    const res = makeRes();
    handler(req, res);

    expect(res._body.channel).toEqual(updated);
    expect(updateChannel).toHaveBeenCalledWith('ch1', { name: 'Updated' });
    expect(clearRedirectCache).toHaveBeenCalledWith('ch1');
    expect(broadcastSchedulerState).toHaveBeenCalled();
  });

  it('returns 500 when updateChannel throws', () => {
    updateChannel.mockImplementation(() => { throw new Error('not found'); });

    const handler = findHandler(router, 'put', '/:id');
    const req = { params: { id: 'ch-missing' }, body: {} };
    const res = makeRes();
    handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('not found');
  });
});

// ── DELETE /:id ────────────────────────────────────────────────────────────
describe('DELETE /:id - delete channel', () => {
  it('returns success on valid delete', async () => {
    deleteChannel.mockResolvedValue({ success: true });

    const handler = findHandler(router, 'delete', '/:id');
    const req = { params: { id: 'ch1' } };
    const res = makeRes();
    await handler(req, res);

    expect(res._body).toEqual({ success: true });
    expect(deleteChannel).toHaveBeenCalledWith('ch1');
    expect(broadcastSchedulerState).toHaveBeenCalled();
  });

  it('returns 500 when deleteChannel throws', async () => {
    deleteChannel.mockRejectedValue(new Error('cannot delete'));

    const handler = findHandler(router, 'delete', '/:id');
    const req = { params: { id: 'ch1' } };
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('cannot delete');
  });
});

// ── POST /:id/reset-health ─────────────────────────────────────────────────
describe('POST /:id/reset-health - reset channel health', () => {
  it('resets health and returns success with health status', () => {
    getChannelHealthStatus.mockReturnValue({ available: true });

    const handler = findHandler(router, 'post', '/:id/reset-health');
    const req = { params: { id: 'ch1' } };
    const res = makeRes();
    handler(req, res);

    expect(res._body.success).toBe(true);
    expect(resetChannelHealth).toHaveBeenCalledWith('ch1', 'claude');
    expect(res._body.health).toEqual({ available: true });
  });

  it('returns 500 when resetChannelHealth throws', () => {
    resetChannelHealth.mockImplementation(() => { throw new Error('reset failed'); });

    const handler = findHandler(router, 'post', '/:id/reset-health');
    const req = { params: { id: 'ch1' } };
    const res = makeRes();
    handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('reset failed');
  });
});

// ── GET /best-for-restore ──────────────────────────────────────────────────
describe('GET /best-for-restore - best channel for restore', () => {
  it('returns best channel', () => {
    const best = { id: 'ch1', name: 'Best' };
    getBestChannelForRestore.mockReturnValue(best);

    const handler = findHandler(router, 'get', '/best-for-restore');
    const res = makeRes();
    handler({}, res);

    expect(res._body.channel).toEqual(best);
  });

  it('returns null when no best channel found', () => {
    const handler = findHandler(router, 'get', '/best-for-restore');
    const res = makeRes();
    handler({}, res);

    expect(res._body.channel).toBeNull();
  });
});

// ── GET /pool/status ───────────────────────────────────────────────────────
describe('GET /pool/status - pool status', () => {
  it('returns scheduler state for default source', () => {
    const state = { channels: ['ch1'], pending: 2 };
    getSchedulerState.mockReturnValue(state);

    const handler = findHandler(router, 'get', '/pool/status');
    const req = { query: {} };
    const res = makeRes();
    handler(req, res);

    expect(res._body.scheduler).toEqual(state);
    expect(res._body.source).toBe('claude');
    expect(getSchedulerState).toHaveBeenCalledWith('claude');
  });

  it('passes source query param to getSchedulerState', () => {
    const handler = findHandler(router, 'get', '/pool/status');
    const req = { query: { source: 'gemini' } };
    const res = makeRes();
    handler(req, res);

    expect(getSchedulerState).toHaveBeenCalledWith('gemini');
    expect(res._body.source).toBe('gemini');
  });
});
