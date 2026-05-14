'use strict';

const http = require('http');

const SERVICE_PATH = require.resolve('../../../src/server/services/channel-balance');
const UI_CONFIG_PATH = require.resolve('../../../src/server/services/ui-config');
const CHANNELS_PATH = require.resolve('../../../src/server/services/channels');

function loadServiceWithStubs({ uiConfig = { channelBalance: { showRemaining: true } }, channelsStub } = {}) {
  delete require.cache[SERVICE_PATH];
  delete require.cache[UI_CONFIG_PATH];
  delete require.cache[CHANNELS_PATH];

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
  });

  test('normalizes OpenAI-style API paths to provider roots', () => {
    const service = loadServiceWithStubs();

    expect(service._test.normalizeBaseUrl('https://api.example.com/v1/responses')).toBe('https://api.example.com');
    expect(service._test.normalizeBaseUrl('https://api.example.com/gateway/v1/chat/completions')).toBe('https://api.example.com/gateway');
    expect(service._test.normalizeBaseUrl('https://api.example.com/v1beta')).toBe('https://api.example.com');
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
      expect(userSelfCount).toBe(2);
      expect(stale).toMatchObject({ visible: true, remaining: 3, stale: true });
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
});
