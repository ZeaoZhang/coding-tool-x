'use strict';

function createDriverResult({ platform, capability, operation, status = 'ok', data, error, cause } = {}) {
  const result = { status, platform, capability, operation };
  if (status === 'ok' && data !== undefined) result.data = data;
  if (error) result.error = error instanceof Error ? error.message : String(error);
  if (cause) Object.defineProperty(result, 'cause', { value: cause, enumerable: false });
  return result;
}

function normalizeDriverResult(value, context = {}) {
  if (value && typeof value === 'object' && typeof value.status === 'string') {
    const result = {
      ...value,
      platform: value.platform || context.platform,
      capability: value.capability || context.capability,
      operation: value.operation || context.operation
    };
    if (value.cause) Object.defineProperty(result, 'cause', { value: value.cause, enumerable: false });
    return result;
  }
  return createDriverResult({ ...context, status: 'ok', data: value });
}

function driverError(result, fallback = 'Driver operation failed') {
  if (!result || typeof result !== 'object' || !result.status || result.status === 'ok') return null;
  if (result.cause instanceof Error) return result.cause;
  const error = new Error(result.error || fallback);
  error.status = result.status;
  error.platform = result.platform;
  error.capability = result.capability;
  error.operation = result.operation;
  return error;
}

function unwrapDriverResult(result, context = {}) {
  const normalized = normalizeDriverResult(result, context);
  const error = driverError(normalized, `Driver operation ${normalized.operation || 'unknown'} failed`);
  if (error) throw error;
  return normalized.status === 'ok' ? normalized.data : normalized;
}

async function invokeDriverOperation(driver, operation, args = [], context = {}) {
  if (!driver || typeof driver[operation] !== 'function') {
    return createDriverResult({ ...context, operation, status: 'unsupported' });
  }
  try {
    const value = await driver[operation](...args);
    return normalizeDriverResult(value, { ...context, operation });
  } catch (error) {
    return createDriverResult({ ...context, operation, status: 'failed', error, cause: error });
  }
}

const ok = (platform, capability, operation, data) => createDriverResult({
  platform, capability, operation, status: 'ok', data
});
const unsupported = (platform, capability, operation) => createDriverResult({
  platform, capability, operation, status: 'unsupported'
});
const invalid = (platform, capability, operation, error) => createDriverResult({
  platform, capability, operation, status: 'invalid', error, cause: error
});
const failed = (platform, capability, operation, error) => createDriverResult({
  platform, capability, operation, status: 'failed', error, cause: error
});

module.exports = {
  createDriverResult,
  normalizeDriverResult,
  driverError,
  unwrapDriverResult,
  invokeDriverOperation,
  ok,
  unsupported,
  invalid,
  failed
};
