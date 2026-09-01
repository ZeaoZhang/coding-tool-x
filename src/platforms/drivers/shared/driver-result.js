'use strict';

function baseResult(status, platform, capability, operation, extra = {}) {
  return { status, platform, capability, operation, ...extra };
}

function ok(platform, capability, operation, data, extra = {}) {
  return baseResult('ok', platform, capability, operation, { data, ...extra });
}

function unsupported(platform, capability, operation, extra = {}) {
  return baseResult('unsupported', platform, capability, operation, extra);
}

function invalid(platform, capability, operation, error, extra = {}) {
  const cause = error instanceof Error ? error : new Error(String(error || 'Invalid input'));
  return baseResult('invalid', platform, capability, operation, {
    error: cause.message,
    ...extra
  });
}

function failed(platform, capability, operation, error, extra = {}) {
  const cause = error instanceof Error ? error : new Error(String(error || 'Driver operation failed'));
  const result = baseResult('failed', platform, capability, operation, {
    error: cause.message,
    ...extra
  });
  Object.defineProperty(result, 'cause', { value: cause, enumerable: false });
  return result;
}

module.exports = { ok, unsupported, invalid, failed };
