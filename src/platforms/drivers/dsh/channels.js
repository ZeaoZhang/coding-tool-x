'use strict';

const implementation = require('./channels-implementation');

function resultFor(request, status, data, error) {
  const route = request?.route || {};
  const result = {
    status,
    platform: 'dsh',
    capability: route.capability || 'channels',
    operation: route.operation || 'channels'
  };
  if (status === 'ok') result.data = data;
  if (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.code = error.code || status;
    Object.defineProperty(result, 'cause', { value: error, enumerable: false });
  }
  return result;
}

function errorStatus(error) {
  if (error?.statusCode === 409) return 'conflict';
  if (error?.statusCode === 422) return 'unprocessable';
  if (error?.statusCode === 400 || /required|invalid|unsupported/i.test(String(error?.message || ''))) return 'invalid';
  return 'failed';
}

function withResult(request, operation, callback) {
  try {
    const value = callback();
    return resultFor({ ...request, route: { ...(request?.route || {}), operation } }, 'ok', value);
  } catch (error) {
    return resultFor({ ...request, route: { ...(request?.route || {}), operation } }, errorStatus(error), undefined, error);
  }
}

function bodyOf(request) {
  if (request && Object.prototype.hasOwnProperty.call(request, 'body')) return request.body || {};
  return request || {};
}

function createDriver(context = {}) {
  implementation.configure(context);
  const driver = {
    platform: 'dsh',
    capability: 'channels',
    getCliMetadata: () => ({
      supportsCliCreate: false,
      supportsCliToggle: true,
      managedProviderConfig: true,
      defaultPort: 20093,
      createUnavailableMessage: '提示: DSH 渠道请通过 Web UI 或 API 添加。'
    }),
    list: request => withResult(request, 'list', () => implementation.getChannels()),
    getChannels: () => implementation.getChannels().channels,
    getEnabled: request => withResult(request, 'enabled', () => ({ channels: implementation.getEnabledChannels() })),
    getEnabledChannels: () => implementation.getEnabledChannels(),
    current: request => withResult(request, 'current', () => implementation.getCurrentChannel()),
    create: request => withResult(request, 'create', () => {
      const channel = implementation.createChannel(bodyOf(request));
      return { channel: implementation.toPublicChannel(channel) };
    }),
    createChannel: fields => implementation.createChannel(fields),
    update: request => withResult(request, 'update', () => {
      const channelId = request?.params?.channelId || bodyOf(request).id;
      if (!channelId) throw Object.assign(new Error('Channel id is required'), { statusCode: 400 });
      const patch = { ...bodyOf(request) };
      delete patch.id;
      const channel = implementation.updateChannel(channelId, patch);
      return { channel: implementation.toPublicChannel(channel) };
    }),
    updateChannel: (id, patch) => implementation.updateChannel(id, patch),
    remove: request => withResult(request, 'remove', () => {
      const channelId = request?.params?.channelId || (typeof request === 'string' ? request : bodyOf(request).id);
      if (!channelId) throw Object.assign(new Error('Channel id is required'), { statusCode: 400 });
      return implementation.deleteChannel(channelId);
    }),
    deleteChannel: id => implementation.deleteChannel(id),
    applyToSettings: request => withResult(request, 'applyToSettings', () => {
      const channelId = request?.params?.channelId || (typeof request === 'string' ? request : bodyOf(request).id);
      if (!channelId) throw Object.assign(new Error('Channel id is required'), { statusCode: 400 });
      return { channel: implementation.toPublicChannel(implementation.applyChannelToSettings(channelId)) };
    }),
    applyNativeConfig: input => {
      const channelId = typeof input === 'string' ? input : input?.params?.channelId || input?.body?.id;
      return implementation.applyChannelToSettings(channelId);
    },
    sync: request => withResult(request, 'sync', () => implementation.syncCurrentDshChannel()),
    syncCurrent: request => withResult(request, 'sync', () => implementation.syncCurrentDshChannel()),
    saveOrder: request => withResult(request, 'order', () => {
      const body = bodyOf(request);
      implementation.getServiceInstance().saveChannelOrder(body.order || body.ids || []);
      return implementation.getChannels();
    }),
    order: request => withResult(request, 'order', () => {
      const body = bodyOf(request);
      implementation.getServiceInstance().saveChannelOrder(body.order || body.ids || []);
      return implementation.getChannels();
    }),
    saveChannelOrder: order => implementation.getServiceInstance().saveChannelOrder(order),
    getEffectiveApiKey: channel => implementation.getEffectiveApiKey(channel),
    getHealthPolicy: () => ({ freezeOnFailure: true }),
    normalizeDashboardChannels: value => {
      if (value && typeof value === 'object' && typeof value.status === 'string') return value;
      return Array.isArray(value) ? { channels: value } : (value || { channels: [] });
    }
  };
  return driver;
}

module.exports = { createDriver };
