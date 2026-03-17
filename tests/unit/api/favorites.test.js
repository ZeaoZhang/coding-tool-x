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

const favModPath = require.resolve('../../../src/server/services/favorites');
const mockAddFavorite = vi.fn();
const mockRemoveFavorite = vi.fn();
const mockIsFavorite = vi.fn();
const mockGetFavorites = vi.fn();
const mockGetAllFavorites = vi.fn();

require.cache[favModPath] = {
  id: favModPath,
  filename: favModPath,
  loaded: true,
  exports: {
    addFavorite: mockAddFavorite,
    removeFavorite: mockRemoveFavorite,
    isFavorite: mockIsFavorite,
    getFavorites: mockGetFavorites,
    getAllFavorites: mockGetAllFavorites
  }
};

const router = require('../../../src/server/api/favorites');

describe('favorites API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns all favorites', () => {
      const allFavs = { claude: [{ sessionId: 's1' }] };
      mockGetAllFavorites.mockReturnValue(allFavs);
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(mockGetAllFavorites).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, favorites: allFavs });
    });

    it('returns 500 when service throws', () => {
      mockGetAllFavorites.mockImplementation(() => { throw new Error('read error'); });
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'read error' });
    });
  });

  describe('GET /:channel', () => {
    it('returns favorites for the given channel', () => {
      const channelFavs = [{ sessionId: 's1' }];
      mockGetFavorites.mockReturnValue(channelFavs);
      const handler = findHandler(router, 'get', '/:channel');
      const req = mockReq({ params: { channel: 'claude' } });
      const res = mockRes();

      handler(req, res);

      expect(mockGetFavorites).toHaveBeenCalledWith('claude');
      expect(res.json).toHaveBeenCalledWith({ success: true, favorites: channelFavs });
    });

    it('returns 500 when service throws', () => {
      mockGetFavorites.mockImplementation(() => { throw new Error('channel error'); });
      const handler = findHandler(router, 'get', '/:channel');
      const req = mockReq({ params: { channel: 'claude' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'channel error' });
    });
  });

  describe('POST /', () => {
    it('adds a favorite and returns the result', () => {
      const result = { success: true };
      mockAddFavorite.mockReturnValue(result);
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: { channel: 'claude', sessionData: { sessionId: 's1' } } });
      const res = mockRes();

      handler(req, res);

      expect(mockAddFavorite).toHaveBeenCalledWith('claude', { sessionId: 's1' });
      expect(res.json).toHaveBeenCalledWith(result);
    });

    it('returns 400 when channel is missing', () => {
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: { sessionData: { sessionId: 's1' } } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
    });

    it('returns 400 when sessionData is missing', () => {
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: { channel: 'claude' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
    });

    it('returns 500 when service throws', () => {
      mockAddFavorite.mockImplementation(() => { throw new Error('add error'); });
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: { channel: 'claude', sessionData: { sessionId: 's1' } } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'add error' });
    });
  });

  describe('DELETE /:channel/:projectName/:sessionId', () => {
    it('removes a favorite and returns the result, decoding projectName', () => {
      const result = { success: true };
      mockRemoveFavorite.mockReturnValue(result);
      const handler = findHandler(router, 'delete', '/:channel/:projectName/:sessionId');
      const req = mockReq({ params: { channel: 'claude', projectName: 'my%20project', sessionId: 's1' } });
      const res = mockRes();

      handler(req, res);

      expect(mockRemoveFavorite).toHaveBeenCalledWith('claude', 'my project', 's1');
      expect(res.json).toHaveBeenCalledWith(result);
    });

    it('returns 500 when service throws', () => {
      mockRemoveFavorite.mockImplementation(() => { throw new Error('remove error'); });
      const handler = findHandler(router, 'delete', '/:channel/:projectName/:sessionId');
      const req = mockReq({ params: { channel: 'claude', projectName: 'project', sessionId: 's1' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'remove error' });
    });
  });

  describe('GET /check/:channel/:projectName/:sessionId', () => {
    it('returns isFavorite boolean', () => {
      mockIsFavorite.mockReturnValue(true);
      const handler = findHandler(router, 'get', '/check/:channel/:projectName/:sessionId');
      const req = mockReq({ params: { channel: 'claude', projectName: 'my%20project', sessionId: 's1' } });
      const res = mockRes();

      handler(req, res);

      expect(mockIsFavorite).toHaveBeenCalledWith('claude', 'my project', 's1');
      expect(res.json).toHaveBeenCalledWith({ success: true, isFavorite: true });
    });

    it('returns 500 when service throws', () => {
      mockIsFavorite.mockImplementation(() => { throw new Error('check error'); });
      const handler = findHandler(router, 'get', '/check/:channel/:projectName/:sessionId');
      const req = mockReq({ params: { channel: 'claude', projectName: 'project', sessionId: 's1' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'check error' });
    });
  });
});
