/**
 * Tests for src/server/api/dashboard.js
 *
 * Pattern: inject vi.fn() stubs into require.cache before requiring the module
 * under test. All 17+ dependencies are stubbed so no real I/O occurs.
 */

// ---------------------------------------------------------------------------
// Resolve all dependency paths relative to the dashboard module location
// ---------------------------------------------------------------------------
const LOADER_PATH                  = require.resolve('../../../src/config/loader');
const UI_CONFIG_PATH               = require.resolve('../../../src/server/services/ui-config');
const FAVORITES_PATH               = require.resolve('../../../src/server/services/favorites');
const CHANNELS_PATH                = require.resolve('../../../src/server/services/channels');
const PROXY_SERVER_PATH            = require.resolve('../../../src/server/proxy-server');
const CODEX_PROXY_PATH             = require.resolve('../../../src/server/codex-proxy-server');
const GEMINI_PROXY_PATH            = require.resolve('../../../src/server/gemini-proxy-server');
const OPENCODE_PROXY_PATH          = require.resolve('../../../src/server/opencode-proxy-server');
const SESSIONS_PATH                = require.resolve('../../../src/server/services/sessions');
const CODEX_SESSIONS_PATH          = require.resolve('../../../src/server/services/codex-sessions');
const GEMINI_SESSIONS_PATH         = require.resolve('../../../src/server/services/gemini-sessions');
const OPENCODE_SESSIONS_PATH       = require.resolve('../../../src/server/services/opencode-sessions');
const CODEX_CHANNELS_PATH          = require.resolve('../../../src/server/services/codex-channels');
const GEMINI_CHANNELS_PATH         = require.resolve('../../../src/server/services/gemini-channels');
const OPENCODE_CHANNELS_PATH       = require.resolve('../../../src/server/services/opencode-channels');
const CLAUDE_STATS_PATH            = require.resolve('../../../src/server/services/claude-statistics-service');
const CODEX_STATS_PATH             = require.resolve('../../../src/server/services/codex-statistics-service');
const GEMINI_STATS_PATH            = require.resolve('../../../src/server/services/gemini-statistics-service');
const OPENCODE_STATS_PATH          = require.resolve('../../../src/server/services/opencode-statistics-service');
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
let getClaudeCounts;
let getCodexCounts;
let getGeminiCounts;
let getOpenCodeCounts;
let getCodexChannels;
let getGeminiChannels;
let getOpenCodeChannels;
let getTodayStatistics;
let getCodexTodayStatistics;
let getGeminiTodayStatistics;
let getOpenCodeTodayStatistics;

function injectStubs() {
  loadConfig               = vi.fn(() => ({ currentProject: 'test-project' }));
  loadUIConfig             = vi.fn(() => ({ theme: 'light' }));
  loadFavorites            = vi.fn(() => ({ claude: [], codex: [], gemini: [], opencode: [] }));
  getAllChannels            = vi.fn(() => []);
  getProxyStatus           = vi.fn(() => null);
  getCodexProxyStatus      = vi.fn(() => null);
  getGeminiProxyStatus     = vi.fn(() => null);
  getOpenCodeProxyStatus   = vi.fn(() => null);
  getClaudeCounts          = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getCodexCounts           = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getGeminiCounts          = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getOpenCodeCounts        = vi.fn(() => ({ projectCount: 0, sessionCount: 0 }));
  getCodexChannels         = vi.fn(() => ({ channels: [] }));
  getGeminiChannels        = vi.fn(() => ({ channels: [] }));
  getOpenCodeChannels      = vi.fn(() => ({ channels: [] }));
  getTodayStatistics       = vi.fn(() => null);
  getCodexTodayStatistics  = vi.fn(() => null);
  getGeminiTodayStatistics = vi.fn(() => null);
  getOpenCodeTodayStatistics = vi.fn(() => null);

  const stub = (absPath, exports) => {
    require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports };
  };

  stub(LOADER_PATH,            { loadConfig });
  stub(UI_CONFIG_PATH,         { loadUIConfig });
  stub(FAVORITES_PATH,         { loadFavorites });
  stub(CHANNELS_PATH,          { getAllChannels });
  stub(PROXY_SERVER_PATH,      { getProxyStatus });
  stub(CODEX_PROXY_PATH,       { getCodexProxyStatus });
  stub(GEMINI_PROXY_PATH,      { getGeminiProxyStatus });
  stub(OPENCODE_PROXY_PATH,    { getOpenCodeProxyStatus });
  stub(SESSIONS_PATH,          { getProjectAndSessionCounts: getClaudeCounts });
  stub(CODEX_SESSIONS_PATH,    { getProjectAndSessionCounts: getCodexCounts });
  stub(GEMINI_SESSIONS_PATH,   { getProjectAndSessionCounts: getGeminiCounts });
  stub(OPENCODE_SESSIONS_PATH, { getProjectAndSessionCounts: getOpenCodeCounts });
  stub(CODEX_CHANNELS_PATH,    { getChannels: getCodexChannels });
  stub(GEMINI_CHANNELS_PATH,   { getChannels: getGeminiChannels });
  stub(OPENCODE_CHANNELS_PATH, { getChannels: getOpenCodeChannels });
  stub(CLAUDE_STATS_PATH,      { getTodayStatistics });
  stub(CODEX_STATS_PATH,       { getTodayStatistics: getCodexTodayStatistics });
  stub(GEMINI_STATS_PATH,      { getTodayStatistics: getGeminiTodayStatistics });
  stub(OPENCODE_STATS_PATH,    { getTodayStatistics: getOpenCodeTodayStatistics });
}

function cleanStubs() {
  const paths = [
    LOADER_PATH, UI_CONFIG_PATH, FAVORITES_PATH, CHANNELS_PATH,
    PROXY_SERVER_PATH, CODEX_PROXY_PATH, GEMINI_PROXY_PATH, OPENCODE_PROXY_PATH,
    SESSIONS_PATH, CODEX_SESSIONS_PATH, GEMINI_SESSIONS_PATH, OPENCODE_SESSIONS_PATH,
    CODEX_CHANNELS_PATH, GEMINI_CHANNELS_PATH, OPENCODE_CHANNELS_PATH,
    CLAUDE_STATS_PATH, CODEX_STATS_PATH, GEMINI_STATS_PATH, OPENCODE_STATS_PATH,
    DASHBOARD_PATH
  ];
  paths.forEach(p => delete require.cache[p]);
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
  });

  it('uiConfig and favorites are passed through from stubs', async () => {
    loadUIConfig.mockReturnValue({ theme: 'dark', fontSize: 14 });
    loadFavorites.mockReturnValue({ claude: ['ch-1'], codex: [], gemini: [], opencode: [] });

    const res = await callInit();
    expect(res._body.data.uiConfig).toEqual({ theme: 'dark', fontSize: 14 });
    expect(res._body.data.favorites).toEqual({ claude: ['ch-1'], codex: [], gemini: [], opencode: [] });
  });

  it('channels has claude, codex, gemini, opencode keys', async () => {
    getAllChannels.mockReturnValue([{ id: 'c1' }]);
    getCodexChannels.mockReturnValue({ channels: [{ id: 'cx1' }] });
    getGeminiChannels.mockReturnValue({ channels: [{ id: 'g1' }] });
    getOpenCodeChannels.mockReturnValue({ channels: [{ id: 'oc1' }] });

    const res = await callInit();
    const { channels } = res._body.data;
    expect(channels).toHaveProperty('claude');
    expect(channels).toHaveProperty('codex');
    expect(channels).toHaveProperty('gemini');
    expect(channels).toHaveProperty('opencode');
    expect(channels.claude).toEqual([{ id: 'c1' }]);
    expect(channels.codex).toEqual({ channels: [{ id: 'cx1' }] });
    expect(channels.opencode).toEqual([{ id: 'oc1' }]);
  });

  it('counts has all four platforms with projectCount and sessionCount', async () => {
    getClaudeCounts.mockReturnValue({ projectCount: 3, sessionCount: 7 });
    getCodexCounts.mockReturnValue({ projectCount: 1, sessionCount: 2 });
    getGeminiCounts.mockReturnValue({ projectCount: 0, sessionCount: 0 });
    getOpenCodeCounts.mockReturnValue({ projectCount: 2, sessionCount: 4 });

    const res = await callInit();
    const { counts } = res._body.data;
    expect(counts.claude).toEqual({ projectCount: 3, sessionCount: 7 });
    expect(counts.codex).toEqual({ projectCount: 1, sessionCount: 2 });
    expect(counts.gemini).toEqual({ projectCount: 0, sessionCount: 0 });
    expect(counts.opencode).toEqual({ projectCount: 2, sessionCount: 4 });
  });

  it('proxyStatus has all four platforms', async () => {
    getProxyStatus.mockReturnValue({ running: true, port: 8080 });
    getCodexProxyStatus.mockReturnValue({ running: false });

    const res = await callInit();
    const { proxyStatus } = res._body.data;
    expect(proxyStatus).toHaveProperty('claude');
    expect(proxyStatus).toHaveProperty('codex');
    expect(proxyStatus).toHaveProperty('gemini');
    expect(proxyStatus).toHaveProperty('opencode');
    expect(proxyStatus.claude).toEqual({ running: true, port: 8080 });
    expect(proxyStatus.codex).toEqual({ running: false });
  });

  it('todayStats returns zero values when services return null', async () => {
    // All stats stubs return null (default)
    const res = await callInit();
    const { todayStats } = res._body.data;
    ['claude', 'codex', 'gemini', 'opencode'].forEach(platform => {
      expect(todayStats[platform]).toEqual({ requests: 0, tokens: 0, cost: 0, byModel: {} });
    });
  });

  it('todayStats extracts summary fields when services return data', async () => {
    getTodayStatistics.mockReturnValue({
      summary: { requests: 10, tokens: 500, cost: 0.05 },
      byModel: { 'claude-3': { requests: 10 } }
    });

    const res = await callInit();
    expect(res._body.data.todayStats.claude).toEqual({
      requests: 10,
      tokens: 500,
      cost: 0.05,
      byModel: { 'claude-3': { requests: 10 } }
    });
    // Other platforms still zero
    expect(res._body.data.todayStats.codex).toEqual({ requests: 0, tokens: 0, cost: 0, byModel: {} });
  });

  it('returns 500 with success:false when a service throws', async () => {
    loadUIConfig.mockImplementation(() => { throw new Error('UI config failed'); });

    const res = await callInit();
    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.message).toBe('UI config failed');
  });
});
