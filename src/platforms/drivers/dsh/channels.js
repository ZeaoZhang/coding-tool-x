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

function withAsyncResult(request, operation, callback) {
  try {
    return Promise.resolve(callback())
      .then(value => resultFor({ ...request, route: { ...(request?.route || {}), operation } }, 'ok', value))
      .catch(error => resultFor({ ...request, route: { ...(request?.route || {}), operation } }, errorStatus(error), undefined, error));
  } catch (error) {
    return Promise.resolve(resultFor({ ...request, route: { ...(request?.route || {}), operation } }, errorStatus(error), undefined, error));
  }
}

function bodyOf(request) {
  if (request && Object.prototype.hasOwnProperty.call(request, 'body')) return request.body || {};
  return request || {};
}

function findChannel(channelId) {
  const data = implementation.getServiceInstance().getChannels();
  const channels = Array.isArray(data) ? data : data?.channels;
  return Array.isArray(channels)
    ? channels.find(channel => String(channel?.id || '') === String(channelId))
    : null;
}

function channelTypeForSpeed(channel) {
  return channel?.providerApi === 'anthropic-messages' ? 'claude'
    : channel?.providerApi === 'openai-responses' ? 'codex'
      : 'openai_compatible';
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
    models: request => withAsyncResult(request, 'models', async () => {
      const { fetchModelsFromProvider } = require('../../../server/services/model-detector');
      const channelId = request?.params?.channelId;
      if (!channelId) throw Object.assign(new Error('Channel id is required'), { statusCode: 400 });
      const channel = findChannel(channelId);
      if (!channel) throw Object.assign(new Error(`Channel not found: ${channelId}`), { statusCode: 400 });
      return fetchModelsFromProvider(channel, channelTypeForSpeed(channel), {
        forceRefresh: request?.query?.forceRefresh === 'true' || request?.query?.force === '1'
      });
    }),
    probeModels: request => withAsyncResult(request, 'probeModels', async () => {
      const { probeModelAvailability } = require('../../../server/services/model-detector');
      const input = bodyOf(request);
      const probe = await probeModelAvailability(input, channelTypeForSpeed(input), {
        forceRefresh: input.forceRefresh === true || input.force === true,
        preferredModels: Array.isArray(input.preferredModels) ? input.preferredModels : [],
        stopOnFirstAvailable: input.stopOnFirstAvailable === true
      });
      return {
        ...probe,
        models: Array.isArray(probe?.availableModels) ? probe.availableModels : []
      };
    }),
    speedTest: request => withAsyncResult(request, 'speedTest', async () => {
      const { testChannelSpeed } = require('../../../server/services/speed-test');
      const channelId = request?.params?.channelId;
      if (!channelId) throw Object.assign(new Error('Channel id is required'), { statusCode: 400 });
      const channel = findChannel(channelId);
      if (!channel) throw Object.assign(new Error(`Channel not found: ${channelId}`), { statusCode: 400 });
      const body = bodyOf(request);
      return testChannelSpeed(
        channel,
        body.timeout,
        channelTypeForSpeed(channel),
        { authSourceType: 'dsh' }
      );
    }),
    speedTestAll: request => withAsyncResult(request, 'speedTestAll', async () => {
      const { testMultipleChannels } = require('../../../server/services/speed-test');
      const body = bodyOf(request);
      const channels = implementation.getServiceInstance().getEnabledChannels();
      const groups = new Map();
      for (const channel of channels) {
        const type = channelTypeForSpeed(channel);
        const group = groups.get(type) || [];
        group.push(channel);
        groups.set(type, group);
      }
      const groupedResults = await Promise.all([...groups.entries()].map(([type, group]) => (
        testMultipleChannels(group, body.timeout, type, body.concurrency)
      )));
      const resultById = new Map(groupedResults.flat().map(result => [result.channelId, result]));
      const results = channels.map(channel => resultById.get(channel.id)).filter(Boolean);
      return { results };
    }),
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
