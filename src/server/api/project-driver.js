'use strict';

const { getPlatformRuntime } = require('../../platforms/runtime');

function driverFailure(result, platform, operation) {
  if (!result || typeof result !== 'object' || result.status === 'ok') return null;
  if (result.cause instanceof Error) return result.cause;
  const error = new Error(result.error || `Project ${operation} failed for ${platform}`);
  error.status = result.status;
  error.platform = result.platform || platform;
  error.capability = result.capability || 'projects';
  error.operation = result.operation || operation;
  return error;
}

function unwrap(result, platform, operation) {
  const failure = driverFailure(result, platform, operation);
  if (failure) throw failure;
  return result?.status === 'ok' ? result.data : result;
}

function invokeProjectDriver(platform, operation, args = []) {
  const runtime = getPlatformRuntime();
  const driver = runtime?.getDriver?.(platform, 'projects');
  if (!driver || typeof driver[operation] !== 'function') {
    const error = new Error(`平台 ${platform} 未声明 projects capability`);
    error.status = 404;
    error.code = 'unsupported';
    error.platform = platform;
    error.capability = 'projects';
    error.operation = operation;
    throw error;
  }
  const result = driver[operation](...args);
  return result && typeof result.then === 'function'
    ? result.then(value => unwrap(value, platform, operation))
    : unwrap(result, platform, operation);
}

module.exports = { invokeProjectDriver };
