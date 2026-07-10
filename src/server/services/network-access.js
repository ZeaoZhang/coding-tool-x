function normalizeAddress(address) {
  if (!address) return '';
  const trimmed = String(address).trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

function isLoopbackAddress(address) {
  const normalized = normalizeAddress(address).toLowerCase();
  if (!normalized) return false;
  if (normalized === '::1' || normalized === 'localhost') return true;
  if (normalized === '127.0.0.1') return true;
  if (normalized.startsWith('127.')) return true;
  return false;
}

function isLoopbackRequest(req) {
  if (!req) return false;
  const socketAddress = req.socket && req.socket.remoteAddress;
  if (!isLoopbackAddress(socketAddress)) {
    return false;
  }
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const first = forwarded.split(',')[0].trim();
    return isLoopbackAddress(first);
  }
  return true;
}

function isSameOriginRequest(req) {
  if (!req) return false;
  const origin = req.headers && req.headers.origin;
  if (!origin) {
    return true;
  }

  const host = req.headers && req.headers.host;
  if (!host) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host;
  } catch (error) {
    return false;
  }
}

function createRemoteMutationGuard(options = {}) {
  const enabled = options.enabled === true;
  const allowRemoteMutation = options.allowRemoteMutation === true;
  const message = options.message || 'LAN 模式下禁止远程写操作';

  return (req, res, next) => {
    if (!enabled || allowRemoteMutation) {
      return next();
    }
    if (isLoopbackRequest(req)) {
      return next();
    }
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    return res.status(403).json({
      error: message,
      code: 'LAN_REMOTE_WRITE_BLOCKED'
    });
  };
}

function isRemoteMutationAllowedByEnv(env = process.env) {
  return String(env.CC_TOOL_ALLOW_REMOTE_WRITE || '').toLowerCase() !== 'false';
}

function createRemoteRouteGuard(options = {}) {
  const enabled = options.enabled === true;
  const allowRemoteAccess = options.allowRemoteAccess === true;
  const message = options.message || 'LAN 模式下禁止远程访问该接口';

  return (req, res, next) => {
    if (!enabled || allowRemoteAccess) {
      return next();
    }
    if (isLoopbackRequest(req)) {
      return next();
    }
    return res.status(403).json({
      error: message,
      code: 'LAN_REMOTE_ROUTE_BLOCKED'
    });
  };
}

function createSameOriginGuard(options = {}) {
  const enabled = options.enabled !== false;
  const message = options.message || '禁止跨站访问该接口';

  return (req, res, next) => {
    if (!enabled || isSameOriginRequest(req)) {
      return next();
    }

    return res.status(403).json({
      error: message,
      code: 'CROSS_ORIGIN_REQUEST_BLOCKED'
    });
  };
}

module.exports = {
  normalizeAddress,
  isLoopbackAddress,
  isLoopbackRequest,
  isSameOriginRequest,
  createRemoteMutationGuard,
  isRemoteMutationAllowedByEnv,
  createRemoteRouteGuard,
  createSameOriginGuard
};
