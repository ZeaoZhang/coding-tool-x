'use strict';

const SECURITY_CONFIG_PATH = require.resolve('../../../src/server/services/security-config');
const API_PATH = require.resolve('../../../src/server/api/security');

let getSecurityStatus;
let verifySecurityPassword;
let setSecurityPassword;
let router;

function injectStubs() {
  getSecurityStatus = vi.fn();
  verifySecurityPassword = vi.fn();
  setSecurityPassword = vi.fn();

  require.cache[SECURITY_CONFIG_PATH] = {
    id: SECURITY_CONFIG_PATH,
    filename: SECURITY_CONFIG_PATH,
    loaded: true,
    exports: { getSecurityStatus, verifySecurityPassword, setSecurityPassword },
  };

  delete require.cache[API_PATH];
  router = require('../../../src/server/api/security');
}

function findHandler(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      const handler = layer.route.stack.find((s) => s.method === method);
      if (handler) return handler.handle;
    }
  }
  return null;
}

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  ...overrides,
});

const mockRes = () => {
  const res = { statusCode: 200, _data: null };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((data) => {
    res._data = data;
    return res;
  });
  return res;
};

describe('security router', () => {
  beforeEach(() => {
    injectStubs();
  });

  afterEach(() => {
    delete require.cache[API_PATH];
    delete require.cache[SECURITY_CONFIG_PATH];
  });

  describe('GET /', () => {
    test('returns security status on success', () => {
      getSecurityStatus.mockReturnValue({ hasPassword: false });
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, hasPassword: false });
      expect(res.statusCode).toBe(200);
    });

    test('returns 500 when service throws', () => {
      getSecurityStatus.mockImplementation(() => {
        throw new Error('disk error');
      });
      const handler = findHandler(router, 'get', '/');
      const req = mockReq();
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'disk error' });
    });
  });

  describe('POST /verify', () => {
    test('returns 400 when password is missing', () => {
      const handler = findHandler(router, 'post', '/verify');
      const req = mockReq({ body: {} });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: '请输入密码' });
    });

    test('returns 400 when password is empty string', () => {
      const handler = findHandler(router, 'post', '/verify');
      const req = mockReq({ body: { password: '' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: '请输入密码' });
    });

    test('returns 400 when password is not set', () => {
      verifySecurityPassword.mockReturnValue({ ok: false, reason: 'not_set' });
      const handler = findHandler(router, 'post', '/verify');
      const req = mockReq({ body: { password: 'test123' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: '尚未设置访问密码' });
    });

    test('returns 401 when password is wrong', () => {
      verifySecurityPassword.mockReturnValue({ ok: false, reason: 'wrong' });
      const handler = findHandler(router, 'post', '/verify');
      const req = mockReq({ body: { password: 'wrongpass' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: '密码错误' });
    });

    test('returns success when password is correct', () => {
      verifySecurityPassword.mockReturnValue({ ok: true });
      const handler = findHandler(router, 'post', '/verify');
      const req = mockReq({ body: { password: 'correctpass' } });
      const res = mockRes();

      handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /password', () => {
    test('returns success with result on successful password set', () => {
      setSecurityPassword.mockReturnValue({ hasPassword: true });
      const handler = findHandler(router, 'post', '/password');
      const req = mockReq({ body: { currentPassword: 'old', newPassword: 'new123' } });
      const res = mockRes();

      handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, hasPassword: true });
      expect(res.statusCode).toBe(200);
    });

    test('returns 400 when password is too weak', () => {
      const err = new Error('too weak');
      err.code = 'WEAK_PASSWORD';
      setSecurityPassword.mockImplementation(() => { throw err; });
      const handler = findHandler(router, 'post', '/password');
      const req = mockReq({ body: { newPassword: '123' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'too weak' });
    });

    test('returns 401 when current password is invalid', () => {
      const err = new Error('wrong current password');
      err.code = 'INVALID_PASSWORD';
      setSecurityPassword.mockImplementation(() => { throw err; });
      const handler = findHandler(router, 'post', '/password');
      const req = mockReq({ body: { currentPassword: 'bad', newPassword: 'new123' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'wrong current password' });
    });

    test('returns 400 for other errors', () => {
      const err = new Error('unexpected failure');
      setSecurityPassword.mockImplementation(() => { throw err; });
      const handler = findHandler(router, 'post', '/password');
      const req = mockReq({ body: { newPassword: 'new123' } });
      const res = mockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'unexpected failure' });
    });
  });
});
