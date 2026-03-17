const { describe, it, expect, vi, beforeEach, afterEach } = await import('vitest');

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

const mockReq = (overrides = {}) => ({ body: {}, params: {}, query: {}, headers: {}, ...overrides });
const mockRes = () => {
  const res = { statusCode: 200, _data: null };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((data) => { res._data = data; return res; });
  return res;
};

const aliasModPath = require.resolve('../../../src/server/services/alias');
const mockSetAlias = vi.fn(() => ({ 'session-1': 'My Session' }));
const mockDeleteAlias = vi.fn(() => ({}));

require.cache[aliasModPath] = {
  id: aliasModPath,
  filename: aliasModPath,
  loaded: true,
  exports: { setAlias: mockSetAlias, deleteAlias: mockDeleteAlias }
};

// Load the router factory after stubbing
const routerFactory = require('../../../src/server/api/aliases');

describe('aliases API', () => {
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetAlias.mockReturnValue({ 'session-1': 'My Session' });
    mockDeleteAlias.mockReturnValue({});
    router = routerFactory();
  });

  describe('POST /', () => {
    it('returns success and aliases when sessionId and alias are provided', () => {
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: { sessionId: 'session-1', alias: 'My Session' } });
      const res = mockRes();

      handler(req, res);

      expect(mockSetAlias).toHaveBeenCalledWith('session-1', 'My Session');
      expect(res.json).toHaveBeenCalledWith({ success: true, aliases: { 'session-1': 'My Session' } });
    });

    it('returns 400 when sessionId is missing', () => {
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: { alias: 'My Session' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'sessionId and alias are required' });
    });

    it('returns 400 when alias is missing', () => {
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: { sessionId: 'session-1' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'sessionId and alias are required' });
    });

    it('returns 500 when service throws', () => {
      const handler = findHandler(router, 'post', '/');
      mockSetAlias.mockImplementation(() => { throw new Error('disk error'); });
      const req = mockReq({ body: { sessionId: 'session-1', alias: 'My Session' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'disk error' });
    });
  });

  describe('DELETE /:sessionId', () => {
    it('returns success and aliases when sessionId is provided', () => {
      const handler = findHandler(router, 'delete', '/:sessionId');
      const req = mockReq({ params: { sessionId: 'session-1' } });
      const res = mockRes();

      handler(req, res);

      expect(mockDeleteAlias).toHaveBeenCalledWith('session-1');
      expect(res.json).toHaveBeenCalledWith({ success: true, aliases: {} });
    });

    it('returns 500 when service throws', () => {
      const handler = findHandler(router, 'delete', '/:sessionId');
      mockDeleteAlias.mockImplementation(() => { throw new Error('delete failed'); });
      const req = mockReq({ params: { sessionId: 'session-1' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'delete failed' });
    });
  });
});
