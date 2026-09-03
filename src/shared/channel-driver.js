'use strict';

const { ok, unsupported, invalid, failed } = require('./driver-result');

const SECRET_KEYS = new Set(['apiKey', 'key', 'token', 'secret', 'password', 'accessToken', 'refreshToken']);
const COMMON_KEYS = new Set([
  'id', 'name', 'baseUrl', 'enabled', 'weight', 'maxConcurrency',
  'routingGroup', 'providerKey', 'providerApi', 'model', 'wireApi',
  'gatewaySourceType', 'websiteUrl', 'createdAt', 'updatedAt'
]);

function sanitizeChannel(channel) {
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) return channel;
  const common = {};
  const extra = {};
  for (const [key, value] of Object.entries(channel)) {
    if (SECRET_KEYS.has(key)) continue;
    (COMMON_KEYS.has(key) ? common : extra)[key] = value;
  }
  return Object.keys(extra).length ? { ...common, extra } : common;
}

function sanitizeChannels(value) {
  const channels = Array.isArray(value) ? value : value?.channels;
  return { channels: Array.isArray(channels) ? channels.map(sanitizeChannel) : [] };
}

function isInvalidError(error) {
  return /invalid|required|not found|must be|unknown channel/i.test(String(error?.message || error));
}

function createChannelDriver({
  platform,
  servicePath,
  localServicePath,
  createArgs,
  listMethod = 'getChannels',
  syncMethod,
  requireImpl,
  capability = 'channels',
  cliMetadata = {},
  formatCliChannelDetails,
  dashboardChannelShape = 'object',
  modelListType
} = {}) {
  let service;
  const loadService = () => {
    if (!service) {
      service = requireImpl ? requireImpl(servicePath) : require(localServicePath);
    }
    return service;
  };

  const call = (operation, method, args = [], transform = value => value) => {
    const target = loadService();
    if (!target || typeof target[method] !== 'function') {
      return unsupported(platform, capability, operation);
    }
    const wrap = value => {
      if (value && typeof value === 'object' && typeof value.status === 'string') return value;
      return ok(platform, capability, operation, transform(value));
    };
    try {
      const value = target[method](...args);
      if (value && typeof value.then === 'function') {
        return value.then(wrap)
          .catch(error => isInvalidError(error)
            ? invalid(platform, capability, operation, error)
            : failed(platform, capability, operation, error));
      }
      return wrap(value);
    } catch (error) {
      return isInvalidError(error)
        ? invalid(platform, capability, operation, error)
        : failed(platform, capability, operation, error);
    }
  };
  const driver = { platform, capability };
  driver.getCliMetadata = () => ({ ...cliMetadata });
  driver.formatCliChannelDetails = typeof formatCliChannelDetails === 'function'
    ? channel => formatCliChannelDetails(channel)
    : () => [];
  driver.normalizeDashboardChannels = value => {
    if (value && typeof value === 'object' && typeof value.status === 'string') return value;
    const channels = Array.isArray(value) ? value : value?.channels;
    if (dashboardChannelShape === 'array') {
      return Array.isArray(channels) ? channels : [];
    }
    if (Array.isArray(channels)) return { channels };
    return value == null ? { channels: [] } : value;
  };
  Object.defineProperty(driver, '_service', { value: loadService, enumerable: false });
  driver.listModels = async (channel, options = {}) => {
    if (!modelListType) {
      return unsupported(platform, capability, 'listModels');
    }
    try {
      const { fetchModelsFromProvider } = require('../server/services/model-detector');
      const data = await fetchModelsFromProvider(channel, modelListType, options);
      return ok(platform, capability, 'listModels', data);
    } catch (error) {
      return failed(platform, capability, 'listModels', error);
    }
  };
  driver.list = (...args) => call('list', listMethod, args, sanitizeChannels);
  driver.getEnabled = (...args) => call('getEnabled', 'getEnabledChannels', args, channels => sanitizeChannels(channels).channels);
  driver.create = (input, ...rest) => {
    if (input == null && rest.length === 0) return invalid(platform, capability, 'create', new Error('Channel input is required'));
    const args = createArgs ? createArgs(input, rest) : [input, ...rest];
    return call('create', 'createChannel', args, sanitizeChannel);
  };
  driver.update = (id, patch) => {
    if (!id || !patch || typeof patch !== 'object') return invalid(platform, capability, 'update', new Error('Channel id and patch are required'));
    return call('update', 'updateChannel', [id, patch], sanitizeChannel);
  };
  driver.remove = id => {
    if (!id) return invalid(platform, capability, 'remove', new Error('Channel id is required'));
    return call('remove', 'deleteChannel', [id]);
  };
  driver.syncCurrent = (...args) => syncMethod
    ? call('syncCurrent', syncMethod, args)
    : unsupported(platform, capability, 'syncCurrent');
  driver.applyNativeConfig = id => id
    ? call('applyNativeConfig', 'applyChannelToSettings', [id], sanitizeChannel)
    : invalid(platform, capability, 'applyNativeConfig', new Error('Channel id is required'));
  driver.getEffectiveApiKey = channel => call('getEffectiveApiKey', 'getEffectiveApiKey', [channel]);
  driver.disableAll = (...args) => call('disableAll', 'disableAllChannels', args);
  driver.markRecentlyUsed = id => id
    ? call('markRecentlyUsed', 'markChannelAsRecentlyUsed', [id], sanitizeChannel)
    : invalid(platform, capability, 'markRecentlyUsed', new Error('Channel id is required'));
  driver.saveOrder = order => call('saveOrder', 'saveChannelOrder', [order]);

  return driver;
}

module.exports = { createChannelDriver, sanitizeChannel, sanitizeChannels };
