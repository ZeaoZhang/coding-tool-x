'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');
const { ok, failed } = require('../../../shared/driver-result');

function providerApiForChannel(channel = {}, input = {}) {
  if (channel.providerApi) return channel.providerApi;
  if (channel.gatewaySourceType === 'claude') return 'anthropic-messages';
  if (channel.gatewaySourceType === 'gemini') return 'google-generative-ai';
  if (channel.gatewaySourceType === 'codex') return 'responses';
  return input.wireApi || 'openai-completions';
}

function createChannelArgs(input, rest) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [input, ...rest];
  const { name, baseUrl, apiKey, extra, ...fields } = input;
  const inputFields = { ...fields, ...(extra || {}) };
  const channel = {
    wireApi: 'openai',
    providerKey: '',
    authMode: 'api_key',
    oauthProviderId: '',
    transport: '',
    routingGroup: '',
    gatewaySourceType: 'openai_compatible',
    enabled: true,
    model: null,
    allowedModels: [],
    speedTestModel: null,
    presetId: null,
    websiteUrl: '',
    balanceToken: '',
    balanceUserId: null,
    models: [],
    modelMetadataMode: 'auto',
    modelBindings: [],
    providerConfig: {},
    ...inputFields
  };
  channel.enabled = channel.enabled !== false;
  channel.allowedModels = Array.isArray(channel.allowedModels) ? channel.allowedModels : [];
  channel.models = Array.isArray(channel.models) ? channel.models : [];
  channel.modelBindings = Array.isArray(channel.modelBindings) ? channel.modelBindings : [];
  channel.providerApi = providerApiForChannel(channel, inputFields);
  return [name, baseUrl, apiKey, channel];
}

function createDriver(context = {}) {
  const { resetChannelHealth } = require('../../../server/services/channel-health');
  const driver = createChannelDriver({
    ...context,
    platform: 'omp',
    servicePath: './omp/channels-implementation',
    localServicePath: '../platforms/drivers/omp/channels-implementation',
    syncMethod: 'syncCurrentOmpChannel',
    modelListType: context.manifest?.channelModelType || 'openai_compatible',
    createArgs: createChannelArgs,
    dashboardChannelShape: 'array'
  });
  const saveOrder = driver.saveOrder;
  driver.saveOrder = input => saveOrder(input?.order || input);
  driver.resetHealth = input => {
    const channelId = typeof input === 'string' ? input : input?.channelId || input?.body?.channelId;
    if (!channelId) throw new Error('Channel id is required');
    resetChannelHealth(channelId, 'omp');
    return { channelId, reset: true };
  };
  driver.syncManagedProviderExtension = (...args) => (
    driver._service().syncManagedProviderExtension(...args)
  );
  driver.catalogMetadata = (input = {}) => {
    const operation = 'catalogMetadata';
    const body = input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'body')
      ? input.body || {}
      : input || {};
    try {
      const value = driver._service().getCatalogMetadata(body);
      const wrap = result => (
        result && typeof result.status === 'string'
          ? result
          : ok('omp', 'channels', operation, result)
      );
      return value && typeof value.then === 'function'
        ? value.then(wrap).catch(error => failed('omp', 'channels', operation, error))
        : wrap(value);
    } catch (error) {
      return failed('omp', 'channels', operation, error);
    }
  };
  const auth = require('../../channel-auth-service');
  driver.getAuth = context => auth.getChannelAuth('omp', { channelId: context?.params?.channelId || context?.query?.channelId || '' });
  driver.syncLocalAuth = context => auth.syncLocalChannelAuth('omp', { channelId: context?.body?.channelId || context?.params?.channelId || context?.query?.channelId || '' });
  driver.getAuthQuota = context => auth.fetchChannelAuthQuota('omp', context?.params?.channelId, { refresh: context?.query?.refresh === 'true' });
  driver.getHealthPolicy = () => ({ freezeOnFailure: false });
  return driver;
}

module.exports = { createDriver };
