'use strict';

const { createRequire } = require('module');

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
  // Evict the router and its deps from cache so stubs take effect.
  const keys = Object.keys(require.cache).filter(k =>
    k.includes('api/ui-config') ||
    k.includes('services/ui-config') ||
    k.includes('services/network-access')
  );
  keys.forEach(k => delete require.cache[k]);

  require.cache[require.resolve('../../../src/server/services/ui-config')] = {
    id: require.resolve('../../../src/server/services/ui-config'),
    filename: require.resolve('../../../src/server/services/ui-config'),
    loaded: true,
    exports: uiConfigStub,
  };

  require.cache[require.resolve('../../../src/server/services/network-access')] = {
    id: require.resolve('../../../src/server/services/network-access'),
    filename: require.resolve('../../../src/server/services/network-access'),
    loaded: true,
    exports: networkAccessStub,
  };

  return require('../../../src/server/api/ui-config');
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
