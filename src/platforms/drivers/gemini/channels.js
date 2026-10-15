'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');

function createDriver(context = {}) {
  const { resetChannelHealth } = require('../../../server/services/channel-health');
  const driver = createChannelDriver({
    ...context,
    platform: 'gemini',
    servicePath: './gemini/channels-implementation',
    localServicePath: '../platforms/drivers/gemini/channels-implementation',
    syncMethod: 'syncCurrentGeminiChannel',
    modelListType: context.manifest?.channelModelType || 'gemini',
    createArgs: (input, rest) => typeof input === 'object'
      ? (() => {
        const { name, baseUrl, apiKey, model, extra, ...channelExtra } = input;
        return [name, baseUrl, apiKey, model, { ...channelExtra, ...extra }];
      })()
      : [input, ...rest],
    formatCliChannelDetails: channel => channel.model ? [`model ${channel.model}`] : []
  });
  const saveOrder = driver.saveOrder;
  driver.saveOrder = input => saveOrder(input?.order || input);
  driver.resetHealth = input => {
    const channelId = typeof input === 'string' ? input : input?.channelId || input?.body?.channelId;
    if (!channelId) throw new Error('Channel id is required');
    resetChannelHealth(channelId, 'gemini');
    return { channelId, reset: true };
  };
  const auth = require('../../channel-auth-service');
  driver.getAuth = context => auth.getChannelAuth('gemini', { channelId: context?.params?.channelId || context?.query?.channelId || '' });
  driver.syncLocalAuth = context => auth.syncLocalChannelAuth('gemini', { channelId: context?.body?.channelId || context?.params?.channelId || context?.query?.channelId || '' });
  driver.getAuthQuota = context => auth.fetchChannelAuthQuota('gemini', context?.params?.channelId, { refresh: context?.query?.refresh === 'true' });
  return driver;
}

module.exports = { createDriver };
