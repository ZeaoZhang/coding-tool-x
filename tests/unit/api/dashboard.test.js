/**
 * Tests for src/server/api/dashboard.js
 *
 * Pattern: inject vi.fn() stubs into require.cache before requiring the module
 * under test. All 17+ dependencies are stubbed so no real I/O occurs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Resolve all dependency paths relative to the dashboard module location
// ---------------------------------------------------------------------------
const LOADER_PATH                  = require.resolve('../../../src/config/loader');
const UI_CONFIG_PATH               = require.resolve('../../../src/server/services/ui-config');
const FAVORITES_PATH               = require.resolve('../../../src/server/services/favorites');
const CHANNELS_PATH                = require.resolve('../../../src/platforms/drivers/claude/channels-implementation');
const PROXY_SERVER_PATH            = require.resolve('../../../src/platforms/drivers/claude/proxy-implementation');
const CODEX_PROXY_PATH             = require.resolve('../../../src/platforms/drivers/codex/proxy-implementation');
const GEMINI_PROXY_PATH            = require.resolve('../../../src/platforms/drivers/gemini/proxy-implementation');
const OPENCODE_PROXY_PATH          = require.resolve('../../../src/platforms/drivers/opencode/proxy-implementation');
const OMP_PROXY_PATH               = require.resolve('../../../src/platforms/drivers/omp/proxy-implementation');
const SESSIONS_PATH                = require.resolve('../../../src/platforms/drivers/claude/sessions-implementation');
const CODEX_SESSIONS_PATH          = require.resolve('../../../src/platforms/drivers/codex/sessions-implementation');
const GEMINI_SESSIONS_PATH         = require.resolve('../../../src/platforms/drivers/gemini/sessions-implementation');
const OPENCODE_SESSIONS_PATH       = require.resolve('../../../src/platforms/drivers/opencode/sessions-implementation');
const OMP_SESSIONS_PATH            = require.resolve('../../../src/platforms/drivers/omp/sessions-implementation');
const CODEX_CHANNELS_PATH          = require.resolve('../../../src/platforms/drivers/codex/channels-implementation');
const GEMINI_CHANNELS_PATH         = require.resolve('../../../src/platforms/drivers/gemini/channels-implementation');
const OPENCODE_CHANNELS_PATH       = require.resolve('../../../src/platforms/drivers/opencode/channels-implementation');
const OMP_CHANNELS_PATH            = require.resolve('../../../src/platforms/drivers/omp/channels-implementation');
const CLAUDE_STATS_PATH            = require.resolve('../../../src/platforms/drivers/claude/statistics-implementation');
const CODEX_STATS_PATH             = require.resolve('../../../src/platforms/drivers/codex/statistics-implementation');
const GEMINI_STATS_PATH            = require.resolve('../../../src/platforms/drivers/gemini/statistics-implementation');
const OPENCODE_STATS_PATH          = require.resolve('../../../src/platforms/drivers/opencode/statistics-implementation');
const OMP_STATS_PATH               = require.resolve('../../../src/platforms/drivers/omp/statistics-implementation');
const PATHS_PATH                   = require.resolve('../../../src/config/paths');
const PLATFORM_RUNTIME_PATH        = require.resolve('../../../src/platforms/runtime');
const SNAPSHOT_CACHE_PATH          = require.resolve('../../../src/server/services/snapshot-cache');
const DASHBOARD_WORKER_PATH        = require.resolve('../../../src/server/services/dashboard-snapshot-worker');
const DASHBOARD_PATH               = require.resolve('../../../src/server/api/dashboard');

// ---------------------------------------------------------------------------
// Stub references – recreated in beforeEach
// ---------------------------------------------------------------------------
let loadConfig;
let loadUIConfig;
let loadFavorites;
let getAllChannels;
let getProxyStatus;
let getCodexProxyStatus;
let getGeminiProxyStatus;
let getOpenCodeProxyStatus;
let getOmpProxyStatus;
let getClaudeCounts;
let getCodexCounts;
let getGeminiCounts;
let getOpenCodeCounts;
let getOmpCounts;
let getCodexChannels;
let getGeminiChannels;
let getOpenCodeChannels;
let getOmpChannels;
let getTodayStatistics;
let getCodexTodayStatistics;
let getGeminiTodayStatistics;
let getOpenCodeTodayStatistics;
let getOmpTodayStatistics;
let platformDefinitions;
let platformRuntime;
let platformRegistry;
let platformDrivers;
let runDashboardSourceWorker;

function injectStubs() {
  delete require.cache[SNAPSHOT_CACHE_PATH];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
  loadConfig               = vi.fn(() => ({ currentProject: 'test-project' }));
  loadUIConfig             = vi.fn(() => ({
    theme: 'light',
    enabledCliPlatforms: ['claude', 'codex', 'gemini', 'opencode', 'omp']
  }));
  loadFavorites            = vi.fn(() => ({ claude: [], codex: [], gemini: [], opencode: [], omp: [] }));
  getAllChannels            = vi.fn(() => []);
  getProxyStatus           = vi.fn(() => null);
  getCodexProxyStatus      = vi.fn(() => null);
  getGeminiProxyStatus     = vi.fn(() => null);
  getOpenCodeProxyStatus   = vi.fn(() => null);
  getOmpProxyStatus        = vi.fn(() => null);
  getClaudeCounts          = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getCodexCounts           = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getGeminiCounts          = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getOpenCodeCounts        = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getOmpCounts             = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getCodexChannels         = vi.fn(() => ({ channels: [] }));
  getGeminiChannels        = vi.fn(() => ({ channels: [] }));
  getOpenCodeChannels      = vi.fn(() => ({ channels: [] }));
  getOmpChannels           = vi.fn(() => ({ channels: [] }));
  getTodayStatistics       = vi.fn(() => null);
  getCodexTodayStatistics  = vi.fn(() => null);
  getGeminiTodayStatistics = vi.fn(() => null);
  getOpenCodeTodayStatistics = vi.fn(() => null);
  getOmpTodayStatistics    = vi.fn(() => null);
  platformDefinitions = [
    { key: 'claude' },
    { key: 'codex' },
    { key: 'gemini' },
    { key: 'opencode' },
    { key: 'omp' }
  ];
  platformDrivers = {
    claude: {
      proxy: { status: getProxyStatus },
      channels: {
        list: getAllChannels,
        normalizeDashboardChannels: value => Array.isArray(value) ? value : value?.channels || []
      },
      counts: { count: getClaudeCounts },
      statistics: { get: getTodayStatistics }
    },
    codex: {
      proxy: { status: getCodexProxyStatus },
      channels: { list: getCodexChannels },
      counts: { count: getCodexCounts },
      statistics: { get: getCodexTodayStatistics }
    },
    gemini: {
      proxy: { status: getGeminiProxyStatus },
      channels: { list: getGeminiChannels },
      counts: { count: getGeminiCounts },
      statistics: { get: getGeminiTodayStatistics }
    },
    opencode: {
      proxy: { status: getOpenCodeProxyStatus },
      channels: {
        list: getOpenCodeChannels,
        normalizeDashboardChannels: value => Array.isArray(value) ? value : value?.channels || []
      },
      counts: { count: getOpenCodeCounts },
      statistics: { get: getOpenCodeTodayStatistics }
    },
    omp: {
      proxy: { status: getOmpProxyStatus },
      channels: {
        list: getOmpChannels,
        normalizeDashboardChannels: value => Array.isArray(value) ? value : value?.channels || []
      },
      counts: { count: getOmpCounts },
      statistics: { get: getOmpTodayStatistics }
    }
  };
  platformRegistry = {
    list: () => platformDefinitions
  };
  platformRuntime = {
    getDriver: vi.fn((platform, capability) => platformDrivers[platform]?.[capability] || null)
  };
  runDashboardSourceWorker = vi.fn(async (source) => {
    const drivers = platformDrivers[source] || {};
    const read = async (driver, operation) => (
      typeof driver?.[operation] === 'function' ? driver[operation]() : null
    );
    return {
      channels: await read(drivers.channels, 'list'),
      todayStats: await read(drivers.statistics, 'get'),
      counts: await read(drivers.counts, 'count')
    };
  });

  const stub = (absPath, exports) => {
    require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports };
  };
  stub(DASHBOARD_WORKER_PATH, { runDashboardSourceWorker });

  stub(PATHS_PATH,            {
    PATHS: {
      storage: tempDir,
      cache: path.join(tempDir, 'cache'),
      snapshotCache: path.join(tempDir, 'cache', 'snapshots')
    }
  });
  stub(LOADER_PATH,            { loadConfig });
  stub(UI_CONFIG_PATH,         { loadUIConfig });
  stub(FAVORITES_PATH,         { loadFavorites });
  stub(CHANNELS_PATH,          { getAllChannels });
  stub(PROXY_SERVER_PATH,      { getProxyStatus });
  stub(CODEX_PROXY_PATH,       { getCodexProxyStatus });
  stub(GEMINI_PROXY_PATH,      { getGeminiProxyStatus });
  stub(OPENCODE_PROXY_PATH,    { getOpenCodeProxyStatus });
  stub(OMP_PROXY_PATH,         { getOmpProxyStatus });
  stub(SESSIONS_PATH,          { getProjectAndSessionCounts: getClaudeCounts });
  stub(CODEX_SESSIONS_PATH,    { getProjectAndSessionCounts: getCodexCounts });
  stub(GEMINI_SESSIONS_PATH,   { getProjectAndSessionCounts: getGeminiCounts });
  stub(OPENCODE_SESSIONS_PATH, { getProjectAndSessionCounts: getOpenCodeCounts });
  stub(OMP_SESSIONS_PATH,      { getProjectAndSessionCounts: getOmpCounts });
  stub(CODEX_CHANNELS_PATH,    { getChannels: getCodexChannels });
  stub(GEMINI_CHANNELS_PATH,   { getChannels: getGeminiChannels });
  stub(OPENCODE_CHANNELS_PATH, { getChannels: getOpenCodeChannels });
  stub(OMP_CHANNELS_PATH,      { getChannels: getOmpChannels });
  stub(CLAUDE_STATS_PATH,      { getTodayStatistics });
  stub(CODEX_STATS_PATH,       { getTodayStatistics: getCodexTodayStatistics });
  stub(PLATFORM_RUNTIME_PATH, {
    getPlatformRegistry: () => platformRegistry,
    getPlatformRuntime: () => platformRuntime
  });
  stub(GEMINI_STATS_PATH,      { getTodayStatistics: getGeminiTodayStatistics });
  stub(OPENCODE_STATS_PATH,    { getTodayStatistics: getOpenCodeTodayStatistics });
  stub(OMP_STATS_PATH,         { getTodayStatistics: getOmpTodayStatistics });
}

function cleanStubs() {
  const paths = [
    LOADER_PATH, UI_CONFIG_PATH, FAVORITES_PATH, CHANNELS_PATH,
    PROXY_SERVER_PATH, CODEX_PROXY_PATH, GEMINI_PROXY_PATH, OPENCODE_PROXY_PATH, OMP_PROXY_PATH,
    SESSIONS_PATH, CODEX_SESSIONS_PATH, GEMINI_SESSIONS_PATH, OPENCODE_SESSIONS_PATH, OMP_SESSIONS_PATH,
    CODEX_CHANNELS_PATH, GEMINI_CHANNELS_PATH, OPENCODE_CHANNELS_PATH, OMP_CHANNELS_PATH,
    CLAUDE_STATS_PATH, CODEX_STATS_PATH, GEMINI_STATS_PATH, OPENCODE_STATS_PATH, OMP_STATS_PATH,
    PATHS_PATH, PLATFORM_RUNTIME_PATH, SNAPSHOT_CACHE_PATH, DASHBOARD_WORKER_PATH,
    DASHBOARD_PATH
  ];
  paths.forEach(p => delete require.cache[p]);
}

function flushDashboardSnapshots() {
  return new Promise(resolve => setTimeout(resolve, 100));
}

// ---------------------------------------------------------------------------
// Minimal Express mock helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body; return this; }
  };
  return res;
}

async function callInit(req = {}) {
  const router = require(DASHBOARD_PATH);
  // Find the GET /init layer
  const layer = router.stack.find(l => l.route && l.route.path === '/init');
  const handler = layer.route.stack[0].handle;
  const res = makeRes();
  await handler(req, res, (err) => { if (err) throw err; });
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/init', () => {
  beforeEach(() => {
    injectStubs();
  });

  afterEach(() => {
    cleanStubs();
  });

  it('returns success:true with all top-level data sections', async () => {
    const res = await callInit();
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data).toBeDefined();
    const { data } = res._body;
    expect(data).toHaveProperty('uiConfig');
    expect(data).toHaveProperty('favorites');
    expect(data).toHaveProperty('channels');
    expect(data).toHaveProperty('proxyStatus');
    expect(data).toHaveProperty('counts');
    expect(data).toHaveProperty('todayStats');
    expect(data).toHaveProperty('meta');
    expect(data.meta.parts).toHaveProperty('counts');
    expect(data.meta.parts).toHaveProperty('todayStats');
    expect(data.meta.parts).toHaveProperty('channels');
  });

  it('uiConfig and favorites are passed through from stubs', async () => {
    loadUIConfig.mockReturnValue({ theme: 'dark', fontSize: 14 });
    loadFavorites.mockReturnValue({ claude: ['ch-1'], codex: [], gemini: [], opencode: [] });

    const res = await callInit();
    expect(res._body.data.uiConfig).toEqual({ theme: 'dark', fontSize: 14 });
    expect(res._body.data.favorites).toEqual({ claude: ['ch-1'], codex: [], gemini: [], opencode: [] });
  });

  it('channels has claude, codex, gemini, opencode, omp keys after snapshots hydrate', async () => {
    getAllChannels.mockReturnValue([{ id: 'c1' }]);
    getCodexChannels.mockReturnValue({ channels: [{ id: 'cx1' }] });
    getGeminiChannels.mockReturnValue({ channels: [{ id: 'g1' }] });
    getOpenCodeChannels.mockReturnValue({ channels: [{ id: 'oc1' }] });
    getOmpChannels.mockReturnValue({ channels: [{ id: 'omp1' }] });

    await callInit();
    await flushDashboardSnapshots();
    const res = await callInit();
    const { channels } = res._body.data;
    expect(channels).toHaveProperty('claude');
    expect(channels).toHaveProperty('codex');
    expect(channels).toHaveProperty('gemini');
    expect(channels).toHaveProperty('opencode');
    expect(channels).toHaveProperty('omp');
    expect(channels.claude).toEqual([{ id: 'c1' }]);
    expect(channels.codex).toEqual({ channels: [{ id: 'cx1' }] });
    expect(channels.opencode).toEqual([{ id: 'oc1' }]);
    expect(channels.omp).toEqual([{ id: 'omp1' }]);
  });

  it('counts has all five platforms with projectCount and sessionCount after snapshots hydrate', async () => {
    getClaudeCounts.mockReturnValue({ projectCount: 3, sessionCount: 7 });
    getCodexCounts.mockReturnValue({ projectCount: 1, sessionCount: 2 });
    getGeminiCounts.mockReturnValue({ projectCount: 0, sessionCount: 0 });
    getOpenCodeCounts.mockReturnValue({ projectCount: 2, sessionCount: 4 });
    getOmpCounts.mockReturnValue({ projectCount: 5, sessionCount: 9 });
    await callInit();
    await flushDashboardSnapshots();
    const res = await callInit();
    const { counts } = res._body.data;
    expect(counts.claude).toEqual({ projectCount: 3, sessionCount: 7 });
    expect(counts.codex).toEqual({ projectCount: 1, sessionCount: 2 });
    expect(counts.gemini).toEqual({ projectCount: 0, sessionCount: 0 });
    expect(counts.opencode).toEqual({ projectCount: 2, sessionCount: 4 });
    expect(counts.omp).toEqual({ projectCount: 5, sessionCount: 9 });
  });

  it('proxyStatus preserves typed failure metadata without exposing raw cause values', async () => {
    const proxyError = new Error('proxy unavailable');
    proxyError.status = 'failed';
    proxyError.retryable = false;
    proxyError.retryAfter = '2026-09-01T12:34:56.000Z';
    proxyError.code = 'E_PROXY';
    getProxyStatus.mockImplementation(() => { throw proxyError; });
    getCodexProxyStatus.mockReturnValue({ running: false });
    getOmpProxyStatus.mockReturnValue({ running: true, port: 20092 });

    const res = await callInit();
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.proxyStatus.claude).toEqual({
      status: 'failed',
      platform: 'claude',
      capability: 'proxy',
      operation: 'status',
      error: 'proxy unavailable',
      retryable: false,
      retryAfter: '2026-09-01T12:34:56.000Z',
      code: 'E_PROXY'
    });
    expect(res._body.data.proxyStatus.claude).not.toHaveProperty('cause');
    expect(res._body.data.proxyStatus.codex).toEqual({ running: false });
    expect(res._body.data.proxyStatus.omp).toEqual({ running: true, port: 20092 });
  });
  it('proxyStatus omits non-finite retryAfter values from typed failures', async () => {
    const proxyError = new Error('proxy unavailable');
    proxyError.status = 'failed';
    proxyError.retryable = true;
    proxyError.retryAfter = Infinity;
    getProxyStatus.mockImplementation(() => { throw proxyError; });

    const res = await callInit();

    expect(res._body.data.proxyStatus.claude).toEqual({
      status: 'failed',
      platform: 'claude',
      capability: 'proxy',
      operation: 'status',
      error: 'proxy unavailable',
      retryable: true
    });
    expect(res._body.data.proxyStatus.claude).not.toHaveProperty('retryAfter');
  });

  it('proxyStatus has all enabled platforms', async () => {
    getProxyStatus.mockReturnValue({ running: true, port: 8080 });
    getCodexProxyStatus.mockReturnValue({ running: false });
    getGeminiProxyStatus.mockReturnValue({ running: false });
    getOpenCodeProxyStatus.mockReturnValue({ running: false });
    getOmpProxyStatus.mockReturnValue({ running: true, port: 20092 });

    const res = await callInit();
    const { proxyStatus } = res._body.data;
    expect(proxyStatus).toEqual({
      claude: { running: true, port: 8080 },
      codex: { running: false },
      gemini: { running: false },
      opencode: { running: false },
      omp: { running: true, port: 20092 }
    });
  });

  it('todayStats returns zero values when services return null', async () => {
    // All stats stubs return null (default)
    const res = await callInit();
    const { todayStats } = res._body.data;
    ['claude', 'codex', 'gemini', 'opencode', 'omp'].forEach(platform => {
      expect(todayStats[platform]).toEqual({ requests: 0, tokens: 0, cost: 0, byModel: {}, byChannel: {} });
    });
  });

  it('todayStats extracts summary fields when services return data', async () => {
    getTodayStatistics.mockReturnValue({
      summary: { requests: 10, tokens: 500, cost: 0.05 },
      byModel: { 'claude-3': { requests: 10 } },
      byChannel: { ch1: { requests: 4, tokens: { total: 250 }, cost: 0.01 } }
    });

    await callInit();
    await flushDashboardSnapshots();
    const res = await callInit();
    expect(res._body.data.todayStats.claude).toEqual({
      requests: 10,
      tokens: 500,
      cost: 0.05,
      byModel: { 'claude-3': { requests: 10 } },
      byChannel: { ch1: { requests: 4, tokens: 250, cost: 0.01 } }
    });
    // Other platforms still zero
    expect(res._body.data.todayStats.codex).toEqual({ requests: 0, tokens: 0, cost: 0, byModel: {}, byChannel: {} });
  });

  it('does not fail dashboard init when a noncritical service throws', async () => {
    loadUIConfig.mockImplementation(() => { throw new Error('UI config failed'); });

    const res = await callInit();
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.uiConfig).toEqual({});
  });

  it('returns before slow OMP snapshots run', async () => {
    getOmpCounts.mockImplementation(() => ({ projectCount: 99, sessionCount: 101 }));

    const res = await callInit();

    expect(res._status).toBe(200);
    expect(getOmpCounts).not.toHaveBeenCalled();
    expect(res._body.data.counts.omp).toEqual({ projectCount: 0, sessionCount: 0 });
    expect(res._body.data.meta.parts.counts.items.omp.refreshing).toBe(true);

    await flushDashboardSnapshots();
    const hydrated = await callInit();
    expect(getOmpCounts).toHaveBeenCalled();
    expect(hydrated._body.data.counts.omp).toEqual({ projectCount: 99, sessionCount: 101 });
  });

  it('only queries enabled registry platforms and maps generic dashboard data', async () => {
    loadUIConfig.mockReturnValue({
      enabledCliPlatforms: ['claude', 'demo-cli', 'not-registered', 'claude']
    });
    platformDefinitions.push({ key: 'demo-cli' });
    platformDrivers['demo-cli'] = {
      proxy: { status: vi.fn(() => ({ running: true, port: 23001 })) },
      channels: { list: vi.fn(() => [{ id: 'demo-channel' }]) },
      counts: { count: vi.fn(() => ({ projectCount: 8, sessionCount: 13 })) },
      statistics: {
        get: vi.fn(() => ({
          summary: { requests: 4, tokens: 12, cost: 0.02 },
          byModel: {},
          byChannel: {}
        }))
      }
    };

    await callInit();
    await flushDashboardSnapshots();
    const res = await callInit();
    const { data } = res._body;

    expect(Object.keys(data.channels)).toEqual(['claude', 'demo-cli']);
    expect(Object.keys(data.counts)).toEqual(['claude', 'demo-cli']);
    expect(Object.keys(data.todayStats)).toEqual(['claude', 'demo-cli']);
    expect(Object.keys(data.proxyStatus)).toEqual(['claude', 'demo-cli']);
    expect(data.channels['demo-cli']).toEqual([{ id: 'demo-channel' }]);
    expect(data.counts['demo-cli']).toEqual({ projectCount: 8, sessionCount: 13 });
    expect(data.todayStats['demo-cli']).toEqual({
      requests: 4,
      tokens: 12,
      cost: 0.02,
      byModel: {},
      byChannel: {}
    });
    expect(runDashboardSourceWorker.mock.calls.map(([source]) => source))
      .toEqual(['claude', 'demo-cli']);
    expect(getCodexProxyStatus).not.toHaveBeenCalled();
    expect(getGeminiProxyStatus).not.toHaveBeenCalled();
    expect(getOpenCodeProxyStatus).not.toHaveBeenCalled();
    expect(getOmpProxyStatus).not.toHaveBeenCalled();
  });
});
