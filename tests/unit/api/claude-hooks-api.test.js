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

const networkModPath = require.resolve('../../../src/server/services/network-access');
require.cache[networkModPath] = {
  id: networkModPath,
  filename: networkModPath,
  loaded: true,
  exports: {
    createSameOriginGuard: () => (_req, _res, next) => next()
  }
};

const hooksModPath = require.resolve('../../../src/server/services/notification-hooks');
const mockGetLegacyClaudeHookSettings = vi.fn();
const mockSaveLegacyClaudeHookSettings = vi.fn();
const mockTestNotification = vi.fn();
const mockInitDefaultHooks = vi.fn();
const parseStopHookStatus = vi.fn();
const parseNotifyTypeMarker = vi.fn();
const buildStopHookCommand = vi.fn();
const shouldRepairStopHook = vi.fn();
const generateSystemNotificationCommand = vi.fn();

require.cache[hooksModPath] = {
  id: hooksModPath,
  filename: hooksModPath,
  loaded: true,
  exports: {
    getLegacyClaudeHookSettings: mockGetLegacyClaudeHookSettings,
    saveLegacyClaudeHookSettings: mockSaveLegacyClaudeHookSettings,
    testNotification: mockTestNotification,
    initDefaultHooks: mockInitDefaultHooks,
    _test: {
      parseStopHookStatus,
      parseNotifyTypeMarker,
      buildStopHookCommand,
      shouldRepairStopHook,
      generateSystemNotificationCommand
    }
  }
};

const homeDirModPath = require.resolve('../../../src/utils/home-dir');
const mockResolvePreferredHomeDir = vi.fn();
const mockNormalizeWindowsHomePath = vi.fn();
require.cache[homeDirModPath] = {
  id: homeDirModPath,
  filename: homeDirModPath,
  loaded: true,
  exports: {
    resolvePreferredHomeDir: mockResolvePreferredHomeDir,
    normalizeWindowsHomePath: mockNormalizeWindowsHomePath
  }
};

const router = require('../../../src/server/api/claude-hooks');

describe('claude-hooks api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns legacy Claude hook settings from unified notification service', () => {
      const settings = {
        success: true,
        stopHook: { enabled: true, type: 'dialog' },
        platform: 'win32'
      };
      mockGetLegacyClaudeHookSettings.mockReturnValue(settings);
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(mockGetLegacyClaudeHookSettings).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(settings);
    });

    it('returns 500 when unified service throws', () => {
      mockGetLegacyClaudeHookSettings.mockImplementation(() => { throw new Error('read failed'); });
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
      mockGetLegacyClaudeHookSettings.mockImplementation(() => { throw err; });
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' });
    });
  });

  describe('POST /', () => {
    it('maps legacy payload through unified service and appends success message', () => {
      const saved = {
        success: true,
        stopHook: { enabled: true, type: 'notification' }
      };
      mockSaveLegacyClaudeHookSettings.mockReturnValue(saved);
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({
        body: {
          stopHook: { enabled: true, type: 'notification' }
        }
      });
      const res = mockRes();

      handler(req, res);

      expect(mockSaveLegacyClaudeHookSettings).toHaveBeenCalledWith(req.body);
      expect(res.json).toHaveBeenCalledWith({ ...saved, message: '配置已保存' });
    });

    it('returns 500 when unified save throws without statusCode', () => {
      mockSaveLegacyClaudeHookSettings.mockImplementation(() => { throw new Error('write failed'); });
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
      mockSaveLegacyClaudeHookSettings.mockImplementation(() => { throw err; });
      const handler = findHandler(router, 'post', '/');
      const req = mockReq({ body: {} });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ error: 'bad request' });
    });
  });

  describe('POST /test', () => {
    it('returns success with system message', async () => {
      mockTestNotification.mockResolvedValue(undefined);
      const handler = findHandler(router, 'post', '/test');
      const req = mockReq({ body: {} });
      const res = mockRes();

      await handler(req, res);

      expect(mockTestNotification).toHaveBeenCalledWith({});
      expect(res.json).toHaveBeenCalledWith({ success: true, message: '系统测试通知已发送' });
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

  describe('compat exports', () => {
    it('re-exports initDefaultHooks from unified service', () => {
      expect(router.initDefaultHooks).toBe(mockInitDefaultHooks);
    });

    it('re-exports compatibility helpers from unified service test surface', () => {
      expect(router._test.parseStopHookStatus).toBe(parseStopHookStatus);
      expect(router._test.parseNotifyTypeMarker).toBe(parseNotifyTypeMarker);
      expect(router._test.buildStopHookCommand).toBe(buildStopHookCommand);
      expect(router._test.shouldRepairStopHook).toBe(shouldRepairStopHook);
      expect(router._test.generateSystemNotificationCommand).toBe(generateSystemNotificationCommand);
    });

    it('still exposes home-dir helpers for regression coverage', () => {
      expect(router._test.resolvePreferredHomeDir).toBe(mockResolvePreferredHomeDir);
      expect(router._test.normalizeWindowsHomePath).toBe(mockNormalizeWindowsHomePath);
    });
  });
});
