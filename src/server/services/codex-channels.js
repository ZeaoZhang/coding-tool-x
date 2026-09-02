'use strict';

const { getPlatformRuntime } = require('../../platforms/runtime');
const IMPLEMENTATION_PATH = require.resolve('../../platforms/drivers/codex/channels-implementation');

function getDriver() {
  delete require.cache[IMPLEMENTATION_PATH];
  return getPlatformRuntime().getDriver('codex', 'channels');
}

function unwrap(value) {
  if (!value || typeof value !== 'object' || typeof value.status !== 'string') return value;
  if (value.status === 'ok') return value.data;
  const error = value.cause instanceof Error ? value.cause : new Error(value.error || value.status);
  if (value.status === 'invalid') error.statusCode = 400;
  throw error;
}

function invoke(method, args) {
  const driver = getDriver();
  if (!driver || typeof driver[method] !== 'function') {
    throw new Error(`Unsupported Codex channels operation: ${method}`);
  }
  const value = driver[method](...args);
  return value && typeof value.then === 'function' ? value.then(unwrap) : unwrap(value);
}

const service = {
  getChannels: (...args) => invoke('getChannels', args),
  getEnabledChannels: (...args) => invoke('getEnabledChannels', args),
  createChannel: (...args) => invoke('createChannel', args),
  updateChannel: (...args) => invoke('updateChannel', args),
  markChannelAsRecentlyUsed: (...args) => invoke('markChannelAsRecentlyUsed', args),
  deleteChannel: (...args) => invoke('deleteChannel', args),
  saveChannelOrder: (...args) => invoke('saveChannelOrder', args),
  syncAllChannelEnvVars: (...args) => invoke('syncAllChannelEnvVars', args),
  writeCodexConfigForMultiChannel: (...args) => invoke('writeCodexConfigForMultiChannel', args),
  applyChannelToSettings: (...args) => invoke('applyChannelToSettings', args),
  getEffectiveApiKey: (...args) => unwrap(getDriver().getEffectiveApiKey(...args)),
  disableAllChannels: (...args) => unwrap(getDriver().disableAll(...args)),
  syncCurrentCodexChannel: (...args) => invoke('syncCurrentCodexChannel', args),
  _test: {}
};

Object.defineProperty(service, '_test', {
  enumerable: true,
  get() {
    return getDriver()._service()._test || {};
  }
});

module.exports = service;
