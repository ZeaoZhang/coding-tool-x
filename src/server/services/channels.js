'use strict';

const { getPlatformRuntime } = require('../../platforms/runtime');
const IMPLEMENTATION_PATH = require.resolve('../../platforms/drivers/claude/channels-implementation');

function getDriver() {
  delete require.cache[IMPLEMENTATION_PATH];
  return getPlatformRuntime().getDriver('claude', 'channels');
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
    throw new Error(`Unsupported Claude channels operation: ${method}`);
  }
  const value = driver[method](...args);
  return value && typeof value.then === 'function' ? value.then(unwrap) : unwrap(value);
}

module.exports = {
  getAllChannels: (...args) => invoke('getAllChannels', args),
  getCurrentChannel: (...args) => invoke('getCurrentChannel', args),
  getCurrentSettings: (...args) => invoke('getCurrentSettings', args),
  createChannel: (...args) => invoke('createChannel', args),
  updateChannel: (...args) => invoke('updateChannel', args),
  markChannelAsRecentlyUsed: (...args) => invoke('markChannelAsRecentlyUsed', args),
  deleteChannel: (...args) => invoke('deleteChannel', args),
  applyChannelToSettings: (...args) => invoke('applyChannelToSettings', args),
  getBestChannelForRestore: (...args) => invoke('getBestChannelForRestore', args),
  updateClaudeSettings: (...args) => invoke('updateClaudeSettings', args),
  updateClaudeSettingsWithModelConfig: (...args) => invoke('updateClaudeSettingsWithModelConfig', args),
  getEffectiveApiKey: (...args) => unwrap(getDriver().getEffectiveApiKey(...args)),
  disableAllChannels: (...args) => unwrap(getDriver().disableAll(...args)),
  extractApiKeyFromHelper: (...args) => invoke('extractApiKeyFromHelper', args),
  syncCurrentClaudeChannel: (...args) => invoke('syncCurrentClaudeChannel', args),
  getChannels: (...args) => unwrap(getDriver().list(...args)),
  getEnabledChannels: (...args) => unwrap(getDriver().getEnabled(...args)),
  saveChannelOrder: (...args) => unwrap(getDriver().saveOrder(...args)),
  _test: {
    getDriver,
    unwrap
  }
};
