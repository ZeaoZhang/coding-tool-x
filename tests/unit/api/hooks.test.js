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

// Stub network-access before loading the router
const networkModPath = require.resolve('../../../src/server/services/network-access');
const mockIsLoopbackRequest = vi.fn(() => true);
require.cache[networkModPath] = {
  id: networkModPath,
  filename: networkModPath,
  loaded: true,
  exports: {
    createSameOriginGuard: () => (req, res, next) => next(),
    normalizeAddress: () => '',
    isLoopbackAddress: () => true,
    isLoopbackRequest: mockIsLoopbackRequest,
    isSameOriginRequest: () => true,
    createRemoteMutationGuard: () => (req, res, next) => next(),
    createRemoteRouteGuard: () => (req, res, next) => next()
  }
};

// Stub notification-hooks before loading the router
const hooksModPath = require.resolve('../../../src/server/services/notification-hooks');
const mockGetNotificationSettings = vi.fn();
const mockSaveNotificationSettings = vi.fn();
const mockTestNotification = vi.fn();
const mockEmitBrowserNotification = vi.fn();

require.cache[hooksModPath] = {
  id: hooksModPath,
  filename: hooksModPath,
  loaded: true,
  exports: {
    getNotificationSettings: mockGetNotificationSettings,
    saveNotificationSettings: mockSaveNotificationSettings,
    testNotification: mockTestNotification,
    emitBrowserNotification: mockEmitBrowserNotification
  }
};

const router = require('../../../src/server/api/hooks');

describe('hooks API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLoopbackRequest.mockReturnValue(true);
  });

  describe('GET /', () => {
    it('returns notification settings', () => {
      const settings = { feishu: { enabled: true, webhook: 'https://example.com' } };
      mockGetNotificationSettings.mockReturnValue(settings);
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(mockGetNotificationSettings).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(settings);
    });

    it('returns 500 when service throws', () => {
      mockGetNotificationSettings.mockImplementation(() => { throw new Error('read failed'); });
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'read failed' });
    });

    it('uses error.statusCode when provided', () => {
      const err = new Error('unauthorized');
      err.statusCode = 403;
      mockGetNotificationSettings.mockImplementation(() => { throw err; });
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' });
    });
  });

  describe('POST /', () => {
    it('saves settings and returns result with message', () => {
      const saved = { feishu: { enabled: false } };
      mockSaveNotificationSettings.mockReturnValue(saved);
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: { feishu: { enabled: false } } });
      const res = mockRes();

      handler(req, res);

      expect(mockSaveNotificationSettings).toHaveBeenCalledWith({ feishu: { enabled: false } });
      expect(res.json).toHaveBeenCalledWith({ ...saved, message: '通知设置已保存' });
    });

    it('returns 500 when service throws without statusCode', () => {
      mockSaveNotificationSettings.mockImplementation(() => { throw new Error('write failed'); });
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: {} });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'write failed' });
    });

    it('uses error.statusCode when provided', () => {
      const err = new Error('bad request');
      err.statusCode = 422;
      mockSaveNotificationSettings.mockImplementation(() => { throw err; });
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: {} });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ error: 'bad request' });
    });
  });

  describe('POST /test', () => {
    it('returns success with system message when testFeishu is absent', async () => {
      mockTestNotification.mockResolvedValue(undefined);
      const handler = findHandler(router, 'post', '/test');
      const req = mockReq({ body: {} });
      const res = mockRes();

      await handler(req, res);

      expect(mockTestNotification).toHaveBeenCalledWith({});
      expect(res.json).toHaveBeenCalledWith({ success: true, message: '系统测试通知已发送' });
    });

    it('returns feishu message when testFeishu is true', async () => {
      mockTestNotification.mockResolvedValue(undefined);
      const handler = findHandler(router, 'post', '/test');
      const req = mockReq({ body: { testFeishu: true } });
      const res = mockRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, message: '飞书测试通知已发送' });
    });

    it('returns 500 when testNotification rejects', async () => {
      mockTestNotification.mockRejectedValue(new Error('send failed'));
      const handler = findHandler(router, 'post', '/test');
      const req = mockReq({ body: {} });
      const res = mockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'send failed' });
    });

    it('uses error.statusCode when testNotification rejects with one', async () => {
      const err = new Error('gateway error');
      err.statusCode = 502;
      mockTestNotification.mockRejectedValue(err);
      const handler = findHandler(router, 'post', '/test');
      const req = mockReq({ body: {} });
      const res = mockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({ error: 'gateway error' });
    });
  });

  describe('POST /browser-event', () => {
    it('broadcasts browser notification payload for loopback requests', () => {
      const notification = { source: 'codex', message: 'done' };
      mockEmitBrowserNotification.mockReturnValue(notification);
      const handler = findHandler(router, 'post', '/browser-event');
      const req = mockReq({ body: { source: 'codex', message: 'done' } });
      const res = mockRes();

      handler(req, res);

      expect(mockEmitBrowserNotification).toHaveBeenCalledWith({ source: 'codex', message: 'done' });
      expect(res.json).toHaveBeenCalledWith({ success: true, notification });
    });

    it('rejects non-loopback browser event requests', () => {
      mockIsLoopbackRequest.mockReturnValue(false);
      const handler = findHandler(router, 'post', '/browser-event');
      const req = mockReq({ body: { source: 'codex', message: 'done' } });
      const res = mockRes();

      handler(req, res);

      expect(mockEmitBrowserNotification).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: '仅允许本机通知脚本访问浏览器通知接口' });
    });

    it('uses service error status code when browser event emission fails', () => {
      const error = new Error('bad payload');
      error.statusCode = 422;
      mockEmitBrowserNotification.mockImplementation(() => {
        throw error;
      });
      const handler = findHandler(router, 'post', '/browser-event');
      const req = mockReq({ body: { source: 'codex' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ error: 'bad payload' });
    });
  });
});
