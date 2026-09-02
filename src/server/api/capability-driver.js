'use strict';

const { getPlatformRuntime } = require('../../platforms/runtime');

function unwrapDriverResult(result, platform, capability, operation) {
  if (!result || typeof result !== 'object' || !result.status) return result;
  if (result.status === 'ok') return result.data;
  if (result.cause instanceof Error) throw result.cause;

  const error = new Error(result.error || `平台 ${platform} 的 ${capability}.${operation} 失败`);
  error.status = result.status;
  error.platform = result.platform || platform;
  error.capability = result.capability || capability;
  error.operation = result.operation || operation;
  throw error;
}

function invokeCapabilityDriver(platform, capability, operation, args = [], runtime = null) {
  const resolvedRuntime = runtime || getPlatformRuntime();
  const driver = resolvedRuntime?.getDriver?.(platform, capability);
  if (!driver || typeof driver[operation] !== 'function') {
    const error = new Error(`平台 ${platform} 未声明 ${capability} capability`);
    error.status = 404;
    error.code = 'unsupported';
    error.platform = platform;
    error.capability = capability;
    error.operation = operation;
    throw error;
  }

  const result = driver[operation](...args);
  return result && typeof result.then === 'function'
    ? result.then(value => unwrapDriverResult(value, platform, capability, operation))
    : unwrapDriverResult(result, platform, capability, operation);
}

module.exports = { invokeCapabilityDriver, unwrapDriverResult };
