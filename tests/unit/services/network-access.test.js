const {
  normalizeAddress,
  isLoopbackAddress,
  isLoopbackRequest,
  isSameOriginRequest,
  createRemoteMutationGuard,
  isRemoteMutationAllowedByEnv,
  createRemoteRouteGuard,
  createSameOriginGuard,
} = require('../../../src/server/services/network-access');

const mockReq = (overrides = {}) => ({
  method: 'GET',
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
  ...overrides,
});

const mockRes = () => {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

describe('normalizeAddress', () => {
  it('returns empty string for null', () => {
    expect(normalizeAddress(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeAddress(undefined)).toBe('');
  });

  it('strips ::ffff: prefix', () => {
    expect(normalizeAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('leaves a normal IP unchanged', () => {
    expect(normalizeAddress('192.168.1.1')).toBe('192.168.1.1');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeAddress('  10.0.0.1  ')).toBe('10.0.0.1');
  });
});

describe('isLoopbackAddress', () => {
  it('returns true for 127.0.0.1', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
  });

  it('returns true for ::1', () => {
    expect(isLoopbackAddress('::1')).toBe(true);
  });

  it('returns true for localhost', () => {
    expect(isLoopbackAddress('localhost')).toBe(true);
  });

  it('returns true for other 127.x.x.x addresses', () => {
    expect(isLoopbackAddress('127.0.0.2')).toBe(true);
    expect(isLoopbackAddress('127.255.255.255')).toBe(true);
  });

  it('returns false for a LAN address', () => {
    expect(isLoopbackAddress('192.168.1.1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isLoopbackAddress('')).toBe(false);
  });

  it('returns false for a public IP', () => {
    expect(isLoopbackAddress('8.8.8.8')).toBe(false);
  });
});

describe('isLoopbackRequest', () => {
  it('returns true when socket is a loopback address', () => {
    const req = mockReq({ socket: { remoteAddress: '127.0.0.1' } });
    expect(isLoopbackRequest(req)).toBe(true);
  });

  it('returns true for ::ffff: prefixed loopback socket', () => {
    const req = mockReq({ socket: { remoteAddress: '::ffff:127.0.0.1' } });
    expect(isLoopbackRequest(req)).toBe(true);
  });

  it('returns false when socket is a remote address', () => {
    const req = mockReq({ socket: { remoteAddress: '203.0.113.5' } });
    expect(isLoopbackRequest(req)).toBe(false);
  });

  it('returns false when loopback socket but x-forwarded-for has a remote IP', () => {
    const req = mockReq({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '203.0.113.5' },
    });
    expect(isLoopbackRequest(req)).toBe(false);
  });

  it('returns true when loopback socket and x-forwarded-for is also loopback', () => {
    const req = mockReq({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    expect(isLoopbackRequest(req)).toBe(true);
  });

  it('returns false for null req', () => {
    expect(isLoopbackRequest(null)).toBe(false);
  });
});

describe('isSameOriginRequest', () => {
  it('returns true when there is no origin header', () => {
    const req = mockReq({ headers: {} });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it('returns true when origin host matches the host header', () => {
    const req = mockReq({
      headers: { origin: 'http://localhost:9999', host: 'localhost:9999' },
    });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it('returns false when origin host does not match the host header', () => {
    const req = mockReq({
      headers: { origin: 'http://evil.example.com', host: 'localhost:9999' },
    });
    expect(isSameOriginRequest(req)).toBe(false);
  });

  it('returns false when origin is present but host header is missing', () => {
    const req = mockReq({
      headers: { origin: 'http://localhost:9999' },
    });
    expect(isSameOriginRequest(req)).toBe(false);
  });

  it('returns false for null req', () => {
    expect(isSameOriginRequest(null)).toBe(false);
  });
});

describe('createRemoteMutationGuard', () => {
  it('calls next() when guard is disabled', () => {
    const guard = createRemoteMutationGuard({ enabled: false });
    const next = vi.fn();
    guard(mockReq({ method: 'POST', socket: { remoteAddress: '203.0.113.5' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when allowRemoteMutation is true', () => {
    const guard = createRemoteMutationGuard({ enabled: true, allowRemoteMutation: true });
    const next = vi.fn();
    guard(mockReq({ method: 'POST', socket: { remoteAddress: '203.0.113.5' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when enabled and request is from loopback', () => {
    const guard = createRemoteMutationGuard({ enabled: true });
    const next = vi.fn();
    guard(mockReq({ method: 'POST', socket: { remoteAddress: '127.0.0.1' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when enabled and remote but method is GET', () => {
    const guard = createRemoteMutationGuard({ enabled: true });
    const next = vi.fn();
    guard(mockReq({ method: 'GET', socket: { remoteAddress: '203.0.113.5' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when enabled and remote but method is HEAD', () => {
    const guard = createRemoteMutationGuard({ enabled: true });
    const next = vi.fn();
    guard(mockReq({ method: 'HEAD', socket: { remoteAddress: '203.0.113.5' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when enabled and remote POST request', () => {
    const guard = createRemoteMutationGuard({ enabled: true });
    const next = vi.fn();
    const res = mockRes();
    guard(mockReq({ method: 'POST', socket: { remoteAddress: '203.0.113.5' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.data.code).toBe('LAN_REMOTE_WRITE_BLOCKED');
  });

  it('returns 403 for remote PUT request', () => {
    const guard = createRemoteMutationGuard({ enabled: true });
    const next = vi.fn();
    const res = mockRes();
    guard(mockReq({ method: 'PUT', socket: { remoteAddress: '10.0.0.5' } }), res, next);
    expect(res.statusCode).toBe(403);
  });
});

describe('isRemoteMutationAllowedByEnv', () => {
  it('defaults to denying remote mutation when env is unset', () => {
    expect(isRemoteMutationAllowedByEnv({})).toBe(false);
  });

  it('allows remote mutation only when env is explicitly true', () => {
    expect(isRemoteMutationAllowedByEnv({ CC_TOOL_ALLOW_REMOTE_WRITE: 'true' })).toBe(true);
    expect(isRemoteMutationAllowedByEnv({ CC_TOOL_ALLOW_REMOTE_WRITE: 'TRUE' })).toBe(true);
  });

  it('blocks remote mutation for false, empty, and unexpected values', () => {
    expect(isRemoteMutationAllowedByEnv({ CC_TOOL_ALLOW_REMOTE_WRITE: 'false' })).toBe(false);
    expect(isRemoteMutationAllowedByEnv({ CC_TOOL_ALLOW_REMOTE_WRITE: '' })).toBe(false);
    expect(isRemoteMutationAllowedByEnv({ CC_TOOL_ALLOW_REMOTE_WRITE: 'yes' })).toBe(false);
  });
});

describe('createRemoteRouteGuard', () => {
  it('calls next() when guard is disabled', () => {
    const guard = createRemoteRouteGuard({ enabled: false });
    const next = vi.fn();
    guard(mockReq({ socket: { remoteAddress: '203.0.113.5' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when allowRemoteAccess is true', () => {
    const guard = createRemoteRouteGuard({ enabled: true, allowRemoteAccess: true });
    const next = vi.fn();
    guard(mockReq({ socket: { remoteAddress: '203.0.113.5' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when enabled and request is from loopback', () => {
    const guard = createRemoteRouteGuard({ enabled: true });
    const next = vi.fn();
    guard(mockReq({ socket: { remoteAddress: '127.0.0.1' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when enabled and request is from remote (GET allowed by mutation guard but not route guard)', () => {
    const guard = createRemoteRouteGuard({ enabled: true });
    const next = vi.fn();
    const res = mockRes();
    guard(mockReq({ method: 'GET', socket: { remoteAddress: '203.0.113.5' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.data.code).toBe('LAN_REMOTE_ROUTE_BLOCKED');
  });

  it('returns 403 for remote POST request', () => {
    const guard = createRemoteRouteGuard({ enabled: true });
    const next = vi.fn();
    const res = mockRes();
    guard(mockReq({ method: 'POST', socket: { remoteAddress: '203.0.113.5' } }), res, next);
    expect(res.statusCode).toBe(403);
  });
});

describe('createSameOriginGuard', () => {
  it('calls next() when guard is disabled via enabled:false', () => {
    const guard = createSameOriginGuard({ enabled: false });
    const next = vi.fn();
    guard(
      mockReq({ headers: { origin: 'http://evil.example.com', host: 'localhost:9999' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when enabled and request is same origin', () => {
    const guard = createSameOriginGuard({ enabled: true });
    const next = vi.fn();
    guard(
      mockReq({ headers: { origin: 'http://localhost:9999', host: 'localhost:9999' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when enabled and no origin header (non-browser / direct API call)', () => {
    const guard = createSameOriginGuard({ enabled: true });
    const next = vi.fn();
    guard(mockReq({ headers: {} }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when enabled and cross-origin request', () => {
    const guard = createSameOriginGuard({ enabled: true });
    const next = vi.fn();
    const res = mockRes();
    guard(
      mockReq({ headers: { origin: 'http://evil.example.com', host: 'localhost:9999' } }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.data.code).toBe('CROSS_ORIGIN_REQUEST_BLOCKED');
  });

  it('is enabled by default (no options)', () => {
    const guard = createSameOriginGuard();
    const next = vi.fn();
    const res = mockRes();
    guard(
      mockReq({ headers: { origin: 'http://attacker.com', host: 'localhost:9999' } }),
      res,
      next
    );
    expect(res.statusCode).toBe(403);
  });
});
