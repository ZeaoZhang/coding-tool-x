'use strict';

const API_PATH = require.resolve('../../../src/server/api/ui-config');
const UI_CONFIG_PATH = require.resolve('../../../src/server/services/ui-config');
const NETWORK_ACCESS_PATH = require.resolve('../../../src/server/services/network-access');

// ── helpers ──────────────────────────────────────────────────────────────────

function findHandler(router, method, routePath) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) {
      for (const s of layer.route.stack) {
        if (s.method === method) return s.handle;
      }
    }
  }
  return null;
}

const mockReq = (o = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
  ...o,
});

const mockRes = () => {
  const r = { statusCode: 200, _data: null };
  r.status = vi.fn(c => { r.statusCode = c; return r; });
  r.json  = vi.fn(d => { r._data = d; return r; });
  return r;
};

// ── stubs ─────────────────────────────────────────────────────────────────────

let uiConfigStub;
let networkAccessStub;

function loadRouter() {
  delete require.cache[API_PATH];
  delete require.cache[UI_CONFIG_PATH];
  delete require.cache[NETWORK_ACCESS_PATH];

  require.cache[UI_CONFIG_PATH] = {
    id: UI_CONFIG_PATH,
    filename: UI_CONFIG_PATH,
    loaded: true,
    exports: uiConfigStub,
  };

  require.cache[NETWORK_ACCESS_PATH] = {
    id: NETWORK_ACCESS_PATH,
    filename: NETWORK_ACCESS_PATH,
    loaded: true,
    exports: networkAccessStub,
  };

  return require(API_PATH);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ui-config API router', () => {
  beforeEach(() => {
    // Pass-through guard middleware
    networkAccessStub = {
      createSameOriginGuard: vi.fn(() => (_req, _res, next) => next()),
    };

    uiConfigStub = {
      loadUIConfig:        vi.fn(),
      saveUIConfig:        vi.fn(),
      updateUIConfig:      vi.fn(),
      updateNestedUIConfig: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[API_PATH];
    delete require.cache[UI_CONFIG_PATH];
    delete require.cache[NETWORK_ACCESS_PATH];
  });

  // ── GET / ────────────────────────────────────────────────────────────────

  it('GET / returns config from loadUIConfig', () => {
    const fakeConfig = { theme: 'dark', lang: 'zh' };
    uiConfigStub.loadUIConfig.mockReturnValue(fakeConfig);

    const router = loadRouter();
    const handler = findHandler(router, 'get', '/');
    const req = mockReq();
    const res = mockRes();

    handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, config: fakeConfig });
    expect(res.statusCode).toBe(200);
  });

  it('GET / returns 500 when loadUIConfig throws', () => {
    uiConfigStub.loadUIConfig.mockImplementation(() => { throw new Error('disk error'); });

    const router = loadRouter();
    const handler = findHandler(router, 'get', '/');
    const req = mockReq();
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'disk error' });
  });

  // ── POST / ───────────────────────────────────────────────────────────────

  it('POST / saves and returns config', () => {
    const fakeConfig = { theme: 'light' };
    uiConfigStub.saveUIConfig.mockReturnValue(undefined);

    const router = loadRouter();
    const handler = findHandler(router, 'post', '/');
    const req = mockReq({ body: { config: fakeConfig } });
    const res = mockRes();

    handler(req, res);

    expect(uiConfigStub.saveUIConfig).toHaveBeenCalledWith(fakeConfig);
    expect(res.json).toHaveBeenCalledWith({ success: true, config: fakeConfig });
  });

  it('POST / returns 400 when config is missing from body', () => {
    const router = loadRouter();
    const handler = findHandler(router, 'post', '/');
    const req = mockReq({ body: {} });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data).toMatchObject({ error: 'Missing config' });
    expect(uiConfigStub.saveUIConfig).not.toHaveBeenCalled();
  });

  it('POST / returns 500 when saveUIConfig throws', () => {
    uiConfigStub.saveUIConfig.mockImplementation(() => { throw new Error('write failed'); });

    const router = loadRouter();
    const handler = findHandler(router, 'post', '/');
    const req = mockReq({ body: { config: { x: 1 } } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'write failed' });
  });

  // ── PUT /:key ─────────────────────────────────────────────────────────────

  it('PUT /:key calls updateUIConfig and returns updated config', () => {
    const updated = { theme: 'dark' };
    uiConfigStub.updateUIConfig.mockReturnValue(updated);

    const router = loadRouter();
    const handler = findHandler(router, 'put', '/:key');
    const req = mockReq({ params: { key: 'theme' }, body: { value: 'dark' } });
    const res = mockRes();

    handler(req, res);

    expect(uiConfigStub.updateUIConfig).toHaveBeenCalledWith('theme', 'dark');
    expect(res.json).toHaveBeenCalledWith({ success: true, config: updated });
  });

  it('PUT /:key returns 500 when updateUIConfig throws', () => {
    uiConfigStub.updateUIConfig.mockImplementation(() => { throw new Error('bad key'); });

    const router = loadRouter();
    const handler = findHandler(router, 'put', '/:key');
    const req = mockReq({ params: { key: 'unknown' }, body: { value: 'v' } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'bad key' });
  });

  // ── PUT /:parentKey/:childKey ─────────────────────────────────────────────

  it('PUT /:parentKey/:childKey calls updateNestedUIConfig and returns config', () => {
    const updated = { sidebar: { collapsed: true } };
    uiConfigStub.updateNestedUIConfig.mockReturnValue(updated);

    const router = loadRouter();
    const handler = findHandler(router, 'put', '/:parentKey/:childKey');
    const req = mockReq({
      params: { parentKey: 'sidebar', childKey: 'collapsed' },
      body: { value: true },
    });
    const res = mockRes();

    handler(req, res);

    expect(uiConfigStub.updateNestedUIConfig).toHaveBeenCalledWith('sidebar', 'collapsed', true);
    expect(res.json).toHaveBeenCalledWith({ success: true, config: updated });
  });

  it('PUT /:parentKey/:childKey returns 500 when updateNestedUIConfig throws', () => {
    uiConfigStub.updateNestedUIConfig.mockImplementation(() => { throw new Error('nested error'); });

    const router = loadRouter();
    const handler = findHandler(router, 'put', '/:parentKey/:childKey');
    const req = mockReq({
      params: { parentKey: 'a', childKey: 'b' },
      body: { value: 1 },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'nested error' });
  });

  // ── middleware wired ───────────────────────────────────────────────────────

  it('createSameOriginGuard is called once during router setup', () => {
    loadRouter();
    expect(networkAccessStub.createSameOriginGuard).toHaveBeenCalledTimes(1);
  });
});
