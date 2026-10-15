'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');

function createChannelArgs(input, rest) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [input, ...rest];
  const { name, baseUrl, apiKey, extra, ...fields } = input;
  const inputFields = { ...fields, ...(extra || {}) };
  const channel = {
    wireApi: 'openai',
    gatewaySourceType: 'codex',
    enabled: true,
    weight: 1,
    maxConcurrency: null,
    model: null,
    modelRedirects: [],
    speedTestModel: null,
    presetId: null,
    providerKey: '',
    websiteUrl: '',
    allowedModels: [],
    authMode: 'api_key',
    oauthProviderId: '',
    balanceToken: '',
    balanceUserId: null,
    ...inputFields
  };
  channel.wireApi = channel.wireApi || 'openai';
  channel.gatewaySourceType = channel.gatewaySourceType || 'codex';
  channel.enabled = channel.enabled !== false;
  channel.weight = channel.weight || 1;
  channel.maxConcurrency = channel.maxConcurrency || null;
  channel.model = channel.model || null;
  channel.modelRedirects = channel.modelRedirects || [];
  channel.speedTestModel = channel.speedTestModel || null;
  channel.presetId = channel.presetId || null;
  channel.providerKey = channel.providerKey || '';
  channel.websiteUrl = channel.websiteUrl || '';
  channel.allowedModels = channel.allowedModels || [];
  channel.authMode = channel.authMode || 'api_key';
  channel.oauthProviderId = channel.oauthProviderId || '';
  channel.balanceToken = channel.balanceToken || '';
  channel.balanceUserId = channel.balanceUserId || null;
  return [name, baseUrl, apiKey, channel];
}

function createDriver(context = {}) {
  const { resetChannelHealth } = require('../../../server/services/channel-health');
  const driver = createChannelDriver({
    ...context,
    platform: 'opencode',
    servicePath: './opencode/channels-implementation',
    localServicePath: '../opencode/channels-implementation',
    syncMethod: 'syncCurrentOpenCodeChannel',
    modelListType: context.manifest?.channelModelType || 'openai_compatible',
    createArgs: createChannelArgs,
    dashboardChannelShape: 'array'
  });
  const saveOrder = driver.saveOrder;
  driver.saveOrder = input => saveOrder(input?.order || input);
  driver.resetHealth = input => {
    const channelId = typeof input === 'string' ? input : input?.channelId || input?.body?.channelId;
    if (!channelId) throw new Error('Channel id is required');
    resetChannelHealth(channelId, 'opencode');
    return { channelId, reset: true };
  };
  const auth = require('../../channel-auth-service');
  driver.getAuth = context => auth.getChannelAuth('opencode', { channelId: context?.params?.channelId || context?.query?.channelId || '' });
  driver.syncLocalAuth = context => auth.syncLocalChannelAuth('opencode', { channelId: context?.body?.channelId || context?.params?.channelId || context?.query?.channelId || '' });
  driver.getAuthQuota = context => auth.fetchChannelAuthQuota('opencode', context?.params?.channelId, { refresh: context?.query?.refresh === 'true' });
  return driver;
}

module.exports = { createDriver };
