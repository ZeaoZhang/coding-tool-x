'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const SERVICE_PATH = require.resolve('../../../src/server/services/channel-balance');
const UI_CONFIG_PATH = require.resolve('../../../src/server/services/ui-config');
const CHANNELS_PATH = require.resolve('../../../src/server/services/channels');
const CODEX_CHANNELS_PATH = require.resolve('../../../src/server/services/codex-channels');
const GEMINI_CHANNELS_PATH = require.resolve('../../../src/server/services/gemini-channels');
const OPENCODE_CHANNELS_PATH = require.resolve('../../../src/server/services/opencode-channels');
const PI_CHANNELS_PATH = require.resolve('../../../src/server/services/pi-channels');
const PATHS_PATH = require.resolve('../../../src/config/paths');

function loadServiceWithStubs({
  uiConfig = { channelBalance: { showRemaining: true } },
  channelsStub,
  codexChannelsStub,
  geminiChannelsStub,
  opencodeChannelsStub,
  piChannelsStub,
  strategyCachePath
} = {}) {
  delete require.cache[SERVICE_PATH];
  delete require.cache[UI_CONFIG_PATH];
  delete require.cache[CHANNELS_PATH];
  delete require.cache[CODEX_CHANNELS_PATH];
  delete require.cache[GEMINI_CHANNELS_PATH];
  delete require.cache[OPENCODE_CHANNELS_PATH];
  delete require.cache[PI_CHANNELS_PATH];
  delete require.cache[PATHS_PATH];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-balance-test-'));
  const cacheDir = path.join(tempDir, 'cache');
  const channelBalanceStrategies = strategyCachePath || path.join(cacheDir, 'channel-balance-strategies.json');

  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      PATHS: {
        storage: tempDir,
        channelModels: path.join(cacheDir, 'channel-models.json'),
        channelBalanceStrategies
      }
    }
  };

  require.cache[UI_CONFIG_PATH] = {
    id: UI_CONFIG_PATH,
    filename: UI_CONFIG_PATH,
    loaded: true,
    exports: {
      loadUIConfig: vi.fn(() => uiConfig)
    }
  };

  if (channelsStub) {
    require.cache[CHANNELS_PATH] = {
      id: CHANNELS_PATH,
      filename: CHANNELS_PATH,
      loaded: true,
      exports: channelsStub
    };
  }
  if (codexChannelsStub) {
    require.cache[CODEX_CHANNELS_PATH] = {
      id: CODEX_CHANNELS_PATH,
      filename: CODEX_CHANNELS_PATH,
      loaded: true,
      exports: codexChannelsStub
    };
  }
  if (geminiChannelsStub) {
    require.cache[GEMINI_CHANNELS_PATH] = {
      id: GEMINI_CHANNELS_PATH,
      filename: GEMINI_CHANNELS_PATH,
      loaded: true,
      exports: geminiChannelsStub
    };
  }
  if (opencodeChannelsStub) {
    require.cache[OPENCODE_CHANNELS_PATH] = {
      id: OPENCODE_CHANNELS_PATH,
      filename: OPENCODE_CHANNELS_PATH,
      loaded: true,
      exports: opencodeChannelsStub
    };
  }
  if (piChannelsStub) {
    require.cache[PI_CHANNELS_PATH] = {
      id: PI_CHANNELS_PATH,
      filename: PI_CHANNELS_PATH,
      loaded: true,
      exports: piChannelsStub
    };
  }

  return require(SERVICE_PATH);
}

async function withJsonServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

describe('channel-balance service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[SERVICE_PATH];
    delete require.cache[UI_CONFIG_PATH];
    delete require.cache[CHANNELS_PATH];
    delete require.cache[CODEX_CHANNELS_PATH];
    delete require.cache[GEMINI_CHANNELS_PATH];
    delete require.cache[OPENCODE_CHANNELS_PATH];
    delete require.cache[PI_CHANNELS_PATH];
    delete require.cache[PATHS_PATH];
  });

  test('normalizes OpenAI-style API paths to provider roots', () => {
    const service = loadServiceWithStubs();

    expect(service._test.normalizeBaseUrl('https://api.example.com/v1/responses')).toBe('https://api.example.com');
    expect(service._test.normalizeBaseUrl('https://api.example.com/gateway/v1/chat/completions')).toBe('https://api.example.com/gateway');
    expect(service._test.normalizeBaseUrl('https://api.example.com/v1beta')).toBe('https://api.example.com');
  });

  test('derives OpenRouter API base from /api/v1 provider URLs', () => {
    const service = loadServiceWithStubs();

    expect(service._test.detectPlatformByUrlHint('https://openrouter.ai/api/v1')).toBe('openrouter');
    expect(service._test.buildOpenRouterApiBaseCandidates('https://openrouter.ai/api/v1', {})).toEqual([
      'https://openrouter.ai/api/v1'
    ]);
    expect(service._test.buildOpenRouterApiBaseCandidates('https://openrouter.ai', {})).toEqual([
      'https://openrouter.ai/api/v1'
    ]);
  });

  test('derives 88code management API from OpenAI-compatible gateway paths', () => {
    const service = loadServiceWithStubs();

    expect(service._test.detectPlatformByUrlHint('88code')).toBe('88code');
    expect(service._test.build88CodeApiBaseCandidates('https://www.88code.ai/openai/v1', {
      providerKey: '88code',
      websiteUrl: 'https://www.88code.ai'
    })).toEqual([
      'https://www.88code.ai/api',
      'https://www.88code.ai/openai/api'
    ]);
  });

  test('derives NewCLI website roots from gateway paths', () => {
    const service = loadServiceWithStubs();

    expect(service._test.detectPlatformByUrlHint('https://code.newcli.com/claude/aws')).toBe('newcli');
    expect(service._test.buildNewCliWebBaseCandidates('https://code.newcli.com/claude/aws', {})).toEqual([
      'https://code.newcli.com'
    ]);
  });

  test('parses metapi-compatible hub balance variants', () => {
    const service = loadServiceWithStubs();
    const payload = { data: { quota: 1000000, used_quota: 250000 } };

    expect(service._test.buildHubBalanceSnapshot('new-api', payload)).toMatchObject({
      visible: true,
      platform: 'new-api',
      remaining: 2,
      used: 0.5,
      total: 2.5,
      label: '余额 $2.00'
    });
    expect(service._test.buildHubBalanceSnapshot('one-api', payload)).toMatchObject({
      visible: true,
      platform: 'one-api',
      remaining: 1.5,
      used: 0.5,
      total: 2,
      label: '余额 $1.50'
    });
    expect(service._test.buildHubBalanceSnapshot('done-hub', payload)).toMatchObject({
      visible: true,
      platform: 'done-hub',
      remaining: 2,
      total: 2.5
    });
    expect(service._test.buildHubBalanceSnapshot('aihubmix', payload)).toMatchObject({
      visible: true,
      platform: 'aihubmix',
      remaining: 2,
      total: 2.5
    });
    expect(service._test.buildHubBalanceSnapshot('veloera', { data: { quota: 1000000, used_quota: 250000 } })).toMatchObject({
      visible: true,
      platform: 'veloera',
      remaining: 0.75,
      used: 0.25,
      total: 1
    });
  });

  test('returns invisible snapshots for unsupported or malformed hub payloads', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildHubBalanceSnapshot('new-api', { data: {} })).toMatchObject({
      visible: false,
      platform: 'new-api'
    });
  });

  test('recognizes AIHubMix status payloads that omit success envelopes', () => {
    const service = loadServiceWithStubs();

    expect(service._test.detectPlatformByUrlHint('https://aihubmix.com')).toBe('aihubmix');
    expect(service._test.resolveStatusPlatform({
      system_name: 'AIHubMix',
      quota_per_unit: 500000
    })).toBe('aihubmix');
  });

  test('keeps known official compatible-mode providers hidden instead of probing gateway adapters', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const server = await withJsonServer((req, res) => {
      return sendJson(res, 500, { error: `unexpected probe ${req.url}` });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'dashscope',
        name: 'DashScope',
        baseUrl: `${server.baseUrl}/compatible-mode/v1`,
        apiKey: 'sk-dashscope'
      });

      expect(snapshot).toMatchObject({
        visible: false,
        platform: 'dashscope'
      });

      const modelscope = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'modelscope',
        name: 'ModelScope',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'ms-modelscope'
      });

      expect(modelscope).toMatchObject({
        visible: false,
        platform: 'modelscope'
      });
    } finally {
      await server.close();
    }
  });

  test('parses New API token usage payloads into key-specific balance snapshots', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildNewApiTokenUsageSnapshot({
      code: true,
      message: 'ok',
      data: {
        object: 'token_usage',
        name: 'key-a',
        total_granted: 2500000,
        total_used: 500000,
        total_available: 2000000,
        unlimited_quota: false
      }
    })).toMatchObject({
      visible: true,
      platform: 'new-api',
      remaining: 4,
      used: 1,
      total: 5,
      label: '余额 $4.00'
    });
  });

  test('uses New API quota_per_unit when parsing token usage payloads', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildNewApiTokenUsageSnapshot({
      data: {
        total_granted: 1000000,
        total_used: 144,
        total_available: 999856,
        unlimited_quota: false
      }
    }, { quotaUnit: 1000000 })).toMatchObject({
      visible: true,
      platform: 'new-api',
      remaining: 0.999856,
      used: 0.000144,
      total: 1,
      label: '余额 $1.00'
    });
  });

  test('shows exhausted New API token usage as zero balance', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildNewApiTokenUsageSnapshot({
      data: {
        total_granted: 0,
        total_used: 20120,
        total_available: -20120,
        unlimited_quota: false
      }
    })).toMatchObject({
      visible: true,
      platform: 'new-api',
      remaining: 0,
      used: 0.04024,
      total: 0,
      label: '余额 $0.00'
    });
  });

  test('still shows New API token usage when unlimited flag includes finite counters', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildNewApiTokenUsageSnapshot({
      data: {
        total_granted: 0,
        total_used: 20120,
        total_available: -20120,
        unlimited_quota: true
      }
    })).toMatchObject({
      visible: true,
      platform: 'new-api',
      remaining: 0,
      label: '余额 $0.00'
    });
  });

  test('parses OpenRouter key limit payloads into key-specific balances', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildOpenRouterKeySnapshot({
      data: {
        label: 'prod-key',
        usage: 3.25,
        limit: 10,
        limit_remaining: 6.75
      }
    })).toMatchObject({
      visible: true,
      platform: 'openrouter',
      remaining: 6.75,
      used: 3.25,
      total: 10,
      label: '余额 $6.75'
    });
  });

  test('parses OpenRouter credits payloads and shows exhausted accounts as zero balance', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildOpenRouterCreditsSnapshot({
      data: {
        total_credits: 0,
        total_usage: 0
      }
    })).toMatchObject({
      visible: true,
      platform: 'openrouter',
      remaining: 0,
      used: 0,
      total: 0,
      label: '余额 $0.00'
    });
  });

  test('parses SiliconFlow user info balances', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildSiliconFlowUserInfoSnapshot({
      status: true,
      data: {
        id: 'user-id',
        balance: '12.34',
        chargeBalance: '20',
        totalBalance: '25'
      }
    })).toMatchObject({
      visible: true,
      platform: 'siliconflow',
      remaining: 12.34,
      used: 12.66,
      total: 25,
      label: '余额 $12.34'
    });
  });

  test('parses 88code usage payloads into visible balance snapshots', () => {
    const service = loadServiceWithStubs();

    expect(service._test.build88CodeUsageSnapshot({
      creditLimit: 100,
      currentCredits: 42.25,
      subscriptionEntityList: [
        { subscriptionName: 'FREE', creditLimit: 5, currentCredits: 5, isActive: true },
        { subscriptionName: 'PLUS', creditLimit: 100, currentCredits: 42.25, isActive: true }
      ]
    })).toMatchObject({
      visible: true,
      platform: '88code',
      remaining: 42.25,
      used: 57.75,
      total: 100,
      label: '余额 $42.25'
    });
  });

  test('parses NewCLI dashboard subscriptions into visible balance snapshots', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildNewCliDashboardSnapshot({
      success: true,
      data: {
        subscription: {
          active: [
            {
              status: 'ACTIVE',
              quotaRemaining: 2500000,
              quotaUsed: 500000,
              plan: { quotaLimit: 3000000 }
            },
            {
              status: 'EXPIRED',
              quotaRemaining: 1000000,
              quotaUsed: 0,
              plan: { quotaLimit: 1000000 }
            }
          ]
        }
      }
    })).toMatchObject({
      visible: true,
      platform: 'newcli',
      remaining: 2.5,
      used: 0.5,
      total: 3,
      label: '余额 $2.50'
    });
  });

  test('falls back to 88code subscription data when usage payload is not usable', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push({ url: req.url, method: req.method, authorization: req.headers.authorization });
      if (req.url === '/api/usage') {
        return sendJson(res, 200, {
          code: 0,
          ok: true,
          msg: 'ok',
          data: {
            creditLimit: null,
            currentCredits: null,
            subscriptionEntityList: null
          }
        });
      }
      if (req.url === '/api/subscription') {
        return sendJson(res, 200, {
          code: 0,
          ok: true,
          msg: 'ok',
          data: [
            {
              id: 2,
              subscriptionPlanName: 'PAYGO',
              subscriptionStatus: '活跃中',
              isActive: true,
              remainingDays: 30,
              creditLimit: 0,
              currentCredits: 13.4
            },
            {
              id: 1,
              subscriptionPlanName: 'PLUS',
              subscriptionStatus: '活跃中',
              isActive: true,
              remainingDays: 12,
              currentCredits: 25,
              subscriptionPlan: { creditLimit: 100 }
            }
          ]
        });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'code88',
        name: '88-code',
        providerKey: '88code',
        baseUrl: `${server.baseUrl}/openai/v1`,
        apiKey: '88_secret'
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: '88code',
        remaining: 25,
        used: 75,
        total: 100,
        label: '余额 $25.00'
      });
      expect(seen.map(item => `${item.method} ${item.url}`)).toEqual([
        'POST /api/usage',
        'POST /api/subscription'
      ]);
      expect(seen.every(item => item.authorization === 'Bearer 88_secret')).toBe(true);
    } finally {
      await server.close();
    }
  });

  test('hides 88code balance when management endpoints fail', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const server = await withJsonServer((req, res) => {
      if (req.url === '/api/usage' || req.url === '/api/subscription') {
        return sendJson(res, 401, { code: 401, ok: false, msg: 'unauthorized' });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'code88-fail',
        providerKey: '88code',
        baseUrl: `${server.baseUrl}/openai/v1`,
        apiKey: '88_secret'
      });

      expect(snapshot).toMatchObject({
        visible: false,
        platform: '88code'
      });
      expect(snapshot).not.toHaveProperty('label');
    } finally {
      await server.close();
    }
  });

  test('fetches NewCLI balance from the website dashboard with dedicated cookie credentials', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push({ url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
      if (req.url === '/api/user/dashboard' && req.headers.cookie === 'auth_token=session-value') {
        return sendJson(res, 200, {
          success: true,
          data: {
            subscription: {
              active: [
                {
                  status: 'ACTIVE',
                  quotaRemaining: 4200000,
                  quotaUsed: 800000,
                  plan: { quotaLimit: 5000000 }
                }
              ]
            }
          }
        });
      }
      return sendJson(res, 401, { message: '请先登录' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('claude', {
        id: 'newcli',
        name: 'NewCLI',
        baseUrl: `${server.baseUrl}/claude/aws`,
        apiKey: 'sk-ant-model',
        balanceToken: 'auth_token=session-value'
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: 'newcli',
        remaining: 4.2,
        used: 0.8,
        total: 5,
        label: '余额 $4.20'
      });
      expect(seen).toEqual([
        { url: '/api/user/dashboard', cookie: 'auth_token=session-value', authorization: undefined }
      ]);
    } finally {
      await server.close();
    }
  });

  test('keeps NewCLI model API keys hidden without probing website login endpoints', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      return sendJson(res, 500, { error: `unexpected probe ${req.url}` });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('claude', {
        id: 'newcli-model-key',
        name: 'NewCLI',
        baseUrl: `${server.baseUrl}/claude/aws`,
        apiKey: 'sk-ant-model'
      });

      expect(snapshot).toMatchObject({
        visible: false,
        platform: 'newcli'
      });
      expect(seen).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test('fetches Sub2API balance and monthly subscription remaining amount', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const server = await withJsonServer((req, res) => {
      if (req.url === '/api/status') return sendJson(res, 404, { error: 'missing' });
      if (req.url === '/api/v1/auth/me') {
        expect(req.headers.authorization).toBe('Bearer secret');
        return sendJson(res, 200, { code: 0, data: { id: 1, balance: '12.5' } });
      }
      if (req.url === '/api/v1/subscriptions/summary') {
        return sendJson(res, 200, {
          code: 0,
          data: {
            subscriptions: [
              { monthlyLimitUsd: 20, monthlyUsedUsd: 8 },
              { monthly_limit_usd: 5, monthly_used_usd: 2 }
            ]
          }
        });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'sub2',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'secret'
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: 'sub2api',
        remaining: 12.5,
        monthlyRemaining: 15,
        label: '余额 $12.50'
      });
    } finally {
      await server.close();
    }
  });

  test('fetches Sub2API model API key balance through /v1/usage', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/api/status') return sendJson(res, 404, { error: 'missing' });
      if (req.url === '/api/v1/auth/me') {
        return sendJson(res, 401, { code: 'INVALID_TOKEN', message: 'Invalid token' });
      }
      if (req.url === '/v1/usage') {
        expect(req.headers.authorization).toBe('Bearer sk-model-key');
        return sendJson(res, 200, {
          balance: 8981.477687,
          isValid: true,
          mode: 'unrestricted',
          planName: '钱包余额',
          remaining: 8981.477687,
          unit: 'USD',
          usage: {
            total: { cost: 1017.02283365 }
          }
        });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'sub2-model-key',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk-model-key'
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: 'sub2api',
        remaining: 8981.477687,
        label: '余额 $8981.48'
      });
      expect(seen).toEqual([
        '/v1/usage'
      ]);
    } finally {
      await server.close();
    }
  });

  test('parses Sub2API quota-limited /v1/usage responses', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildSub2ApiUsageSnapshot({
      isValid: true,
      mode: 'quota_limited',
      status: 'active',
      remaining: 8.5,
      unit: 'USD',
      quota: {
        limit: 10,
        used: 1.5,
        remaining: 8.5,
        unit: 'USD'
      }
    })).toMatchObject({
      visible: true,
      platform: 'sub2api',
      remaining: 8.5,
      used: 1.5,
      total: 10,
      label: '余额 $8.50'
    });
  });

  test('parses Sub2API subscription monthly remaining from /v1/usage', () => {
    const service = loadServiceWithStubs();

    expect(service._test.buildSub2ApiUsageSnapshot({
      isValid: true,
      mode: 'unrestricted',
      planName: 'Pro',
      unit: 'USD',
      subscription: {
        monthly_limit_usd: 20,
        monthly_usage_usd: 4.25
      }
    })).toMatchObject({
      visible: true,
      platform: 'sub2api',
      monthlyRemaining: 15.75,
      label: '月余 $15.75'
    });
  });

  test('recognizes Sub2API error envelopes without exposing an upstream error', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const server = await withJsonServer((req, res) => {
      if (req.url === '/api/status') return sendJson(res, 404, { error: 'missing' });
      if (req.url === '/api/v1/auth/me') {
        return sendJson(res, 401, { code: 'INVALID_TOKEN', message: 'Invalid token' });
      }
      if (req.url === '/v1/usage') {
        return sendJson(res, 401, { error: { type: 'authentication_error' } });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'sub2-invalid-token',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk-model-key'
      });

      expect(snapshot).toMatchObject({
        visible: false,
        platform: 'sub2api'
      });
    } finally {
      await server.close();
    }
  });

  test('prefers a dedicated balance token over the model API key', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const authHeaders = [];
    const server = await withJsonServer((req, res) => {
      authHeaders.push(req.headers.authorization || '');
      if (req.url === '/api/status') {
        return sendJson(res, 200, { success: true, data: { system_name: 'New API', quota_per_unit: 500000 } });
      }
      if (req.url === '/api/user/self') {
        return sendJson(res, 200, { success: true, data: { quota: 1000000, used_quota: 0 } });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'dedicated-balance-token',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'model-key',
        balanceToken: 'balance-session'
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: 'new-api',
        remaining: 2
      });
      expect(authHeaders).toContain('Bearer balance-session');
      expect(authHeaders).not.toContain('Bearer model-key');
    } finally {
      await server.close();
    }
  });

  test('uses New API user headers and cookie balance credentials for AnyRouter-style sessions', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push({
        url: req.url,
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        newApiUser: req.headers['new-api-user']
      });
      if (req.url === '/api/user/self' && req.headers.cookie === 'session=session-value' && req.headers['new-api-user'] === '8899') {
        return sendJson(res, 200, {
          success: true,
          data: {
            id: 8899,
            quota: 1250000,
            used_quota: 250000
          }
        });
      }
      if (req.url === '/api/user/self') {
        return sendJson(res, 401, { success: false, message: 'missing New-Api-User' });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'anyrouter-session',
        name: 'AnyRouter',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk-model-key',
        balanceToken: 'session-value',
        balanceUserId: 8899
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: 'anyrouter',
        remaining: 2.5,
        used: 0.5,
        total: 3,
        label: '余额 $2.50'
      });
      expect(seen.some(item => item.authorization === 'Bearer session-value' && item.newApiUser === '8899')).toBe(true);
      expect(seen.some(item => item.cookie === 'session=session-value' && item.newApiUser === '8899')).toBe(true);
    } finally {
      await server.close();
    }
  });

  test('keeps AnyRouter model API keys hidden when only model routing works', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/v1/models') {
        return sendJson(res, 200, { data: [{ id: 'gpt-4.1' }] });
      }
      if (req.url === '/api/user/self' || req.url === '/api/status' || req.url === '/api/usage/token') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><title>AnyRouter</title></html>');
        return;
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'anyrouter-api-key',
        name: 'AnyRouter',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk-anyrouter-key'
      });

      expect(snapshot).toMatchObject({
        visible: false,
        platform: 'anyrouter'
      });
      expect(snapshot).not.toHaveProperty('label');
      const forced = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'anyrouter-api-key',
        name: 'AnyRouter',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk-anyrouter-key'
      }, { force: true });
      expect(forced).toMatchObject({
        visible: false,
        platform: 'anyrouter'
      });
      expect(seen).toEqual(['/api/user/self', '/v1/usage']);
    } finally {
      await server.close();
    }
  });

  test('retries hidden balance probes only after the channel balance cache is cleared', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/api/status' || req.url === '/api/usage/token') {
        return sendJson(res, 404, { error: 'missing' });
      }
      if (req.url === '/v1/usage') {
        return sendJson(res, 200, { mode: 'limited', isValid: false });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const channel = {
        id: 'hidden-retry',
        name: 'AnyRouter',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk-hidden'
      };
      const first = await service._test.refreshChannelBalanceSnapshot('codex', channel);
      const forced = await service._test.refreshChannelBalanceSnapshot('codex', channel, { force: true });
      service._test.clearChannelBalanceCache('codex', channel);
      const afterReenable = await service._test.refreshChannelBalanceSnapshot('codex', channel, { force: true });

      expect(first).toMatchObject({ visible: false, platform: 'anyrouter' });
      expect(forced).toMatchObject({ visible: false, platform: 'anyrouter' });
      expect(afterReenable).toMatchObject({ visible: false, platform: 'anyrouter' });
      expect(seen).toEqual([
        '/api/user/self',
        '/v1/usage',
        '/api/user/self',
        '/v1/usage'
      ]);
    } finally {
      await server.close();
    }
  });

  test('uses cache and returns stale visible snapshot after refresh failure', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    let fail = false;
    let userSelfCount = 0;
    const server = await withJsonServer((req, res) => {
      if (req.url === '/api/status') {
        return sendJson(res, 200, { success: true, data: { system_name: 'New API' } });
      }
      if (req.url === '/api/user/self') {
        userSelfCount += 1;
        if (fail) return sendJson(res, 500, { error: 'down' });
        return sendJson(res, 200, { success: true, data: { quota: 1500000, used_quota: 500000 } });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const channel = { id: 'new-api', baseUrl: `${server.baseUrl}/v1/responses`, apiKey: 'secret' };
      const first = await service._test.refreshChannelBalanceSnapshot('claude', channel);
      const cached = await service._test.refreshChannelBalanceSnapshot('claude', channel);
      fail = true;
      const stale = await service._test.refreshChannelBalanceSnapshot('claude', channel, { force: true });

      expect(first.remaining).toBe(3);
      expect(cached.remaining).toBe(3);
      expect(userSelfCount).toBe(3);
      expect(stale).toMatchObject({ visible: true, remaining: 3, stale: true });
    } finally {
      await server.close();
    }
  });

  test('records the first successful balance endpoint and reuses it on refresh', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/api/status') {
        return sendJson(res, 200, { success: true, data: { system_name: 'New API' } });
      }
      if (req.url === '/api/user/self') {
        return sendJson(res, 200, { success: true, data: { quota: 2000000, used_quota: 500000 } });
      }
      if (req.url === '/v1/usage') {
        return sendJson(res, 200, { mode: 'unrestricted', remaining: 99, isValid: true });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const channel = { id: 'strategy-cache', baseUrl: `${server.baseUrl}/v1`, apiKey: 'secret' };
      const first = await service._test.refreshChannelBalanceSnapshot('codex', channel);
      const forced = await service._test.refreshChannelBalanceSnapshot('codex', channel, { force: true });

      expect(first).toMatchObject({
        visible: true,
        platform: 'new-api',
        remaining: 4
      });
      expect(forced).toMatchObject({
        visible: true,
        platform: 'new-api',
        remaining: 4
      });
      expect(seen).toEqual([
        '/api/status',
        '/api/user/self',
        '/api/user/self'
      ]);
    } finally {
      await server.close();
    }
  });

  test('persists the successful balance endpoint across service reloads', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-balance-strategy-cache-'));
    const strategyCachePath = path.join(cacheDir, 'strategies.json');
    let service = loadServiceWithStubs({ strategyCachePath });
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/api/status') {
        return sendJson(res, 200, { success: true, data: { system_name: 'New API' } });
      }
      if (req.url === '/api/user/self') {
        return sendJson(res, 200, { success: true, data: { quota: 2000000, used_quota: 500000 } });
      }
      if (req.url === '/v1/usage') {
        return sendJson(res, 200, { mode: 'unrestricted', remaining: 99, isValid: true });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const channel = { id: 'persistent-strategy-cache', baseUrl: `${server.baseUrl}/v1`, apiKey: 'secret' };
      const first = await service._test.refreshChannelBalanceSnapshot('codex', channel);

      delete require.cache[SERVICE_PATH];
      service = loadServiceWithStubs({ strategyCachePath });
      const reloaded = await service._test.refreshChannelBalanceSnapshot('codex', channel, { force: true });

      expect(first).toMatchObject({
        visible: true,
        platform: 'new-api',
        remaining: 4
      });
      expect(reloaded).toMatchObject({
        visible: true,
        platform: 'new-api',
        remaining: 4
      });
      expect(seen).toEqual([
        '/api/status',
        '/api/user/self',
        '/api/user/self'
      ]);
    } finally {
      await server.close();
    }
  });

  test('fetches New API key-specific balance with the model API key', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/v1/usage') {
        return sendJson(res, 404, { error: 'not sub2api' });
      }
      if (req.url === '/api/status') {
        return sendJson(res, 200, {
          success: true,
          data: {
            system_name: 'New API',
            quota_per_unit: 1000000
          }
        });
      }
      if (req.url === '/api/usage/token') {
        expect(req.headers.authorization).toBe('Bearer sk-newapi-key');
        return sendJson(res, 200, {
          code: true,
          message: 'ok',
          data: {
            object: 'token_usage',
            name: 'new-api-key',
            total_granted: 3000000,
            total_used: 1250000,
            total_available: 1750000,
            unlimited_quota: false
          }
        });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'new-api-token-usage',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk-newapi-key'
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: 'new-api',
        remaining: 1.75,
        used: 1.25,
        total: 3,
        label: '余额 $1.75'
      });
      expect(seen).toEqual([
        '/v1/usage',
        '/api/status',
        '/api/usage/token'
      ]);
    } finally {
      await server.close();
    }
  });

  test('fetches OpenRouter key balance before generic gateway probes', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/api/v1/key') {
        expect(req.headers.authorization).toBe('Bearer sk-or-test');
        return sendJson(res, 200, {
          data: {
            label: 'limited-key',
            usage: 2,
            limit: 5,
            limit_remaining: 3
          }
        });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const channel = {
        id: 'openrouter-key',
        baseUrl: `${server.baseUrl}/api/v1`,
        apiKey: 'sk-or-test'
      };
      const first = await service._test.refreshChannelBalanceSnapshot('codex', channel);
      const forced = await service._test.refreshChannelBalanceSnapshot('codex', channel, { force: true });

      expect(first).toMatchObject({
        visible: true,
        platform: 'openrouter',
        remaining: 3,
        used: 2,
        total: 5,
        label: '余额 $3.00'
      });
      expect(forced).toMatchObject({
        visible: true,
        platform: 'openrouter',
        remaining: 3
      });
      expect(seen).toEqual([
        '/api/v1/key',
        '/api/v1/key'
      ]);
    } finally {
      await server.close();
    }
  });

  test('falls back to OpenRouter account credits when key limits are absent', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/api/v1/key' || req.url === '/api/v1/auth/key') {
        return sendJson(res, 200, {
          data: {
            label: 'account-key',
            usage: 0,
            limit: null,
            limit_remaining: null
          }
        });
      }
      if (req.url === '/api/v1/credits') {
        expect(req.headers.authorization).toBe('Bearer sk-or-test');
        return sendJson(res, 200, {
          data: {
            total_credits: 0,
            total_usage: 0
          }
        });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'openrouter-credits',
        name: 'OpenRouter',
        baseUrl: `${server.baseUrl}/api/v1`,
        apiKey: 'sk-or-test'
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: 'openrouter',
        remaining: 0,
        used: 0,
        total: 0,
        label: '余额 $0.00'
      });
      expect(seen).toEqual([
        '/api/v1/key',
        '/api/v1/auth/key',
        '/api/v1/credits'
      ]);
    } finally {
      await server.close();
    }
  });

  test('fetches SiliconFlow balance through the official user info endpoint', async () => {
    const service = loadServiceWithStubs();
    service._test.clearBalanceCache();
    const seen = [];
    const server = await withJsonServer((req, res) => {
      seen.push(req.url);
      if (req.url === '/v1/user/info') {
        expect(req.headers.authorization).toBe('Bearer sk-silicon');
        return sendJson(res, 200, {
          status: true,
          data: {
            balance: 9.5,
            chargeBalance: 10,
            totalBalance: 10
          }
        });
      }
      return sendJson(res, 404, { error: 'missing' });
    });

    try {
      const snapshot = await service._test.refreshChannelBalanceSnapshot('codex', {
        id: 'siliconflow',
        name: 'SiliconFlow',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk-silicon'
      });

      expect(snapshot).toMatchObject({
        visible: true,
        platform: 'siliconflow',
        remaining: 9.5,
        total: 10,
        label: '余额 $9.50'
      });
      expect(seen).toEqual(['/v1/user/info']);
    } finally {
      await server.close();
    }
  });

  test('does not read channel storage when balance display is disabled', async () => {
    const service = loadServiceWithStubs({
      uiConfig: { channelBalance: { showRemaining: false } },
      channelsStub: {
        getAllChannels: vi.fn(() => {
          throw new Error('should not read channels');
        })
      }
    });

    await expect(service.getChannelBalances('claude')).resolves.toEqual({
      enabled: false,
      source: 'claude',
      balances: {}
    });
  });

  test('accepts OMP as a valid source when balance display is disabled', async () => {
    const service = loadServiceWithStubs({
      uiConfig: { channelBalance: { showRemaining: false } },
      piChannelsStub: {
        getChannels: vi.fn(() => {
          throw new Error('should not read OMP channels');
        })
      }
    });

    await expect(service.getChannelBalances('pi')).resolves.toEqual({
      enabled: false,
      source: 'pi',
      balances: {}
    });
  });

  test('loads balances only for enabled channels', async () => {
    let enabledRequests = 0;
    let disabledRequests = 0;
    const enabledServer = await withJsonServer((req, res) => {
      enabledRequests += 1;
      if (req.url === '/v1/usage') {
        return sendJson(res, 200, { mode: 'unrestricted', remaining: 8.25, isValid: true });
      }
      return sendJson(res, 404, { error: 'missing' });
    });
    const disabledServer = await withJsonServer((req, res) => {
      disabledRequests += 1;
      return sendJson(res, 500, { error: `disabled channel should not be requested: ${req.url}` });
    });

    try {
      const service = loadServiceWithStubs({
        codexChannelsStub: {
          getChannels: vi.fn(() => ({
            channels: [
              { id: 'enabled-new-api', enabled: true, baseUrl: `${enabledServer.baseUrl}/v1`, apiKey: 'sk-enabled' },
              { id: 'disabled-new-api', enabled: false, baseUrl: `${disabledServer.baseUrl}/v1`, apiKey: 'sk-disabled' }
            ]
          }))
        }
      });

      const result = await service.getChannelBalances('codex');

      expect(result.enabled).toBe(true);
      expect(result.balances).toMatchObject({
        'enabled-new-api': {
          visible: true,
          platform: 'sub2api',
          remaining: 8.25
        }
      });
      expect(Object.keys(result.balances)).toEqual(['enabled-new-api']);
      expect(service._test.getEnabledBalanceChannels('codex').map(channel => channel.id)).toEqual(['enabled-new-api']);
      expect(enabledRequests).toBeGreaterThan(0);
      expect(disabledRequests).toBe(0);
    } finally {
      await enabledServer.close();
      await disabledServer.close();
    }
  });

  test('loads balances from enabled OMP channels', async () => {
    const seenAuth = [];
    const enabledServer = await withJsonServer((req, res) => {
      seenAuth.push({
        url: req.url,
        auth: req.headers.authorization,
        userId: req.headers['new-api-user']
      });
      if (req.url === '/v1/usage') {
        return sendJson(res, 200, { mode: 'unrestricted', remaining: 4.5, isValid: true });
      }
      return sendJson(res, 404, { error: 'missing' });
    });
    const disabledServer = await withJsonServer((_req, res) => {
      return sendJson(res, 500, { error: 'disabled OMP channel should not be requested' });
    });

    try {
      const service = loadServiceWithStubs({
        piChannelsStub: {
          getChannels: vi.fn(() => ({
            channels: [
              {
                id: 'omp-enabled',
                enabled: true,
                baseUrl: `${enabledServer.baseUrl}/v1`,
                apiKey: 'sk-api-key',
                balanceToken: 'balance-token',
                balanceUserId: 8899
              },
              {
                id: 'omp-disabled',
                enabled: false,
                baseUrl: `${disabledServer.baseUrl}/v1`,
                apiKey: 'sk-disabled'
              }
            ]
          }))
        }
      });

      const result = await service.getChannelBalances('pi');

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('pi');
      expect(result.balances).toMatchObject({
        'omp-enabled': {
          visible: true,
          platform: 'sub2api',
          remaining: 4.5
        }
      });
      expect(Object.keys(result.balances)).toEqual(['omp-enabled']);
      expect(service._test.getEnabledBalanceChannels('pi').map(channel => channel.id)).toEqual(['omp-enabled']);
      expect(seenAuth.some(item => item.auth === 'Bearer balance-token')).toBe(true);
    } finally {
      await enabledServer.close();
      await disabledServer.close();
    }
  });
});
