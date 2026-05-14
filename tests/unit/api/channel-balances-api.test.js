'use strict';

const API_PATH = require.resolve('../../../src/server/api/channel-balances');
const SERVICE_PATH = require.resolve('../../../src/server/services/channel-balance');
const NETWORK_ACCESS_PATH = require.resolve('../../../src/server/services/network-access');

let serviceStub;
let networkAccessStub;

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

function mockRes() {
  return {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
}

function loadRouter() {
  delete require.cache[API_PATH];
  delete require.cache[SERVICE_PATH];
  delete require.cache[NETWORK_ACCESS_PATH];

  require.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    loaded: true,
    exports: serviceStub
  };
  require.cache[NETWORK_ACCESS_PATH] = {
    id: NETWORK_ACCESS_PATH,
    filename: NETWORK_ACCESS_PATH,
    loaded: true,
    exports: networkAccessStub
  };

  return require(API_PATH);
}

describe('channel-balances API router', () => {
  beforeEach(() => {
    serviceStub = {
      getChannelBalances: vi.fn(async (source) => ({
        enabled: true,
        source,
        balances: { ch1: { visible: true, label: '余额 $1.00' } }
      })),
      refreshChannelBalance: vi.fn(async (source, id) => ({
        enabled: true,
        source,
        channelId: id,
        balance: { visible: true, label: '余额 $2.00' }
      }))
    };
    networkAccessStub = {
      createSameOriginGuard: vi.fn(() => (_req, _res, next) => next())
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[API_PATH];
    delete require.cache[SERVICE_PATH];
    delete require.cache[NETWORK_ACCESS_PATH];
  });

  test('GET / returns channel balances for source', async () => {
    const router = loadRouter();
    const handler = findHandler(router, 'get', '/');
    const res = mockRes();

    await handler({ query: { source: 'codex' } }, res);

    expect(serviceStub.getChannelBalances).toHaveBeenCalledWith('codex');
    expect(res._body).toEqual({
      enabled: true,
      source: 'codex',
      balances: { ch1: { visible: true, label: '余额 $1.00' } }
    });
  });

  test('POST /:source/:id/refresh refreshes a single channel balance', async () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/:source/:id/refresh');
    const res = mockRes();

    await handler({ params: { source: 'claude', id: 'ch1' } }, res);

    expect(serviceStub.refreshChannelBalance).toHaveBeenCalledWith('claude', 'ch1');
    expect(res._body).toEqual({
      enabled: true,
      source: 'claude',
      channelId: 'ch1',
      balance: { visible: true, label: '余额 $2.00' }
    });
  });

  test('returns 400 for invalid source and 404 for missing channel', async () => {
    serviceStub.getChannelBalances.mockRejectedValueOnce(new Error('Invalid channel balance source'));
    const notFound = new Error('Channel not found');
    notFound.statusCode = 404;
    serviceStub.refreshChannelBalance.mockRejectedValueOnce(notFound);

    const router = loadRouter();

    let handler = findHandler(router, 'get', '/');
    let res = mockRes();
    await handler({ query: { source: 'bad' } }, res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'Invalid source' });

    handler = findHandler(router, 'post', '/:source/:id/refresh');
    res = mockRes();
    await handler({ params: { source: 'codex', id: 'missing' } }, res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Channel not found' });
  });

  test('wires same-origin guard', () => {
    loadRouter();
    expect(networkAccessStub.createSameOriginGuard).toHaveBeenCalledTimes(1);
  });
});
