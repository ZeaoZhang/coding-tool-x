'use strict';

const API_PATH = require.resolve('../../../src/server/api/ui-config');
const UI_CONFIG_PATH = require.resolve('../../../src/server/services/ui-config');
const NETWORK_ACCESS_PATH = require.resolve('../../../src/server/services/network-access');

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
  body: {}, params: {}, query: {}, headers: {},
  socket: { remoteAddress: '127.0.0.1' }, ...o
});

const mockRes = () => {
  const r = { statusCode: 200, _data: null };
  r.status = vi.fn(c => { r.statusCode = c; return r; });
  r.json = vi.fn(d => { r._data = d; return r; });
  return r;
};

let uiConfigStub;
let networkAccessStub;

function loadRouter() {
  delete require.cache[API_PATH];
  delete require.cache[UI_CONFIG_PATH];
  delete require.cache[NETWORK_ACCESS_PATH];
  require.cache[UI_CONFIG_PATH] = {
    id: UI_CONFIG_PATH, filename: UI_CONFIG_PATH, loaded: true, exports: uiConfigStub
  };
  require.cache[NETWORK_ACCESS_PATH] = {
    id: NETWORK_ACCESS_PATH, filename: NETWORK_ACCESS_PATH, loaded: true, exports: networkAccessStub
  };
  return require(API_PATH);
}

describe('ui-config API router', () => {
  beforeEach(() => {
    networkAccessStub = { createSameOriginGuard: vi.fn(() => (_req, _res, next) => next()) };
    uiConfigStub = {
      loadUIConfig: vi.fn(), saveUIConfig: vi.fn(),
      updateUIConfig: vi.fn(), updateNestedUIConfig: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[API_PATH];
    delete require.cache[UI_CONFIG_PATH];
    delete require.cache[NETWORK_ACCESS_PATH];
  });

  it('GET / returns config from loadUIConfig', () => {
    const config = { enabledCliPlatforms: ['claude'] };
    uiConfigStub.loadUIConfig.mockReturnValue(config);
    const handler = findHandler(loadRouter(), 'get', '/');
    const res = mockRes();
    handler(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, config });
    expect(res.statusCode).toBe(200);
  });

  it('GET / returns 500 when loadUIConfig throws', () => {
    uiConfigStub.loadUIConfig.mockImplementation(() => { throw new Error('disk error'); });
    const handler = findHandler(loadRouter(), 'get', '/');
    const res = mockRes();
    handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'disk error' });
  });

  it('POST / returns normalized config from saveUIConfig', () => {
    const request = { theme: 'dark', enabledCliPlatforms: ['claude', 'unknown'] };
    const normalized = { theme: 'dark', enabledCliPlatforms: ['claude'] };
    uiConfigStub.saveUIConfig.mockReturnValue(normalized);
    const handler = findHandler(loadRouter(), 'post', '/');
    const res = mockRes();
    handler(mockReq({ body: { config: request } }), res);
    expect(uiConfigStub.saveUIConfig).toHaveBeenCalledWith(request);
    expect(res.json).toHaveBeenCalledWith({ success: true, config: normalized });
  });

  it('POST / returns 400 when config is missing', () => {
    const handler = findHandler(loadRouter(), 'post', '/');
    const res = mockRes();
    handler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data).toMatchObject({ error: 'Missing config' });
    expect(uiConfigStub.saveUIConfig).not.toHaveBeenCalled();
  });

  it('POST / returns 500 when saveUIConfig throws', () => {
    uiConfigStub.saveUIConfig.mockImplementation(() => { throw new Error('write failed'); });
    const handler = findHandler(loadRouter(), 'post', '/');
    const res = mockRes();
    handler(mockReq({ body: { config: { theme: 'dark' } } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'write failed' });
  });

  it('PUT /:key returns normalized updated config', () => {
    const updated = { enabledCliPlatforms: ['omp'] };
    uiConfigStub.updateUIConfig.mockReturnValue(updated);
    const handler = findHandler(loadRouter(), 'put', '/:key');
    const res = mockRes();
    handler(mockReq({ params: { key: 'enabledCliPlatforms' }, body: { value: ['omp'] } }), res);
    expect(uiConfigStub.updateUIConfig).toHaveBeenCalledWith('enabledCliPlatforms', ['omp']);
    expect(res.json).toHaveBeenCalledWith({ success: true, config: updated });
  });

  it('PUT /:key returns 500 when updateUIConfig throws', () => {
    uiConfigStub.updateUIConfig.mockImplementation(() => { throw new Error('bad key'); });
    const handler = findHandler(loadRouter(), 'put', '/:key');
    const res = mockRes();
    handler(mockReq({ params: { key: 'unknown' }, body: { value: 'v' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'bad key' });
  });

  it('PUT /:parentKey/:childKey returns normalized config', () => {
    const updated = { panelVisibility: { showLogs: false } };
    uiConfigStub.updateNestedUIConfig.mockReturnValue(updated);
    const handler = findHandler(loadRouter(), 'put', '/:parentKey/:childKey');
    const res = mockRes();
    handler(mockReq({
      params: { parentKey: 'panelVisibility', childKey: 'showLogs' }, body: { value: false }
    }), res);
    expect(uiConfigStub.updateNestedUIConfig).toHaveBeenCalledWith('panelVisibility', 'showLogs', false);
    expect(res.json).toHaveBeenCalledWith({ success: true, config: updated });
  });

  it('PUT /:parentKey/:childKey returns 500 when updateNestedUIConfig throws', () => {
    uiConfigStub.updateNestedUIConfig.mockImplementation(() => { throw new Error('nested error'); });
    const handler = findHandler(loadRouter(), 'put', '/:parentKey/:childKey');
    const res = mockRes();
    handler(mockReq({ params: { parentKey: 'a', childKey: 'b' }, body: { value: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'nested error' });
  });

  it('wires createSameOriginGuard once', () => {
    loadRouter();
    expect(networkAccessStub.createSameOriginGuard).toHaveBeenCalledTimes(1);
  });
});
