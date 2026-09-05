'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');

function createDriver(context = {}) {
  const driver = createChannelDriver({
    ...context,
    platform: 'claude',
    servicePath: './claude/channels-implementation',
    localServicePath: '../platforms/drivers/claude/channels-implementation',
    listMethod: 'getAllChannels',
    syncMethod: 'syncCurrentClaudeChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? (() => {
        const { name, baseUrl, apiKey, websiteUrl, extra, ...channelExtra } = input;
        return [name, baseUrl, apiKey, websiteUrl, { ...channelExtra, ...extra }];
      })()
      : [input, ...rest],
    cliMetadata: { supportsCliCreate: true, supportsCliToggle: true, defaultPort: 20088 },
    dashboardChannelShape: 'array'
  });
  const callLegacy = (name, args) => driver._service()[name](...args);
  const auth = require('../../channel-auth-service');
  driver.getAuth = context => auth.getChannelAuth('claude', { channelId: context?.params?.channelId || context?.query?.channelId || '' });
  driver.syncLocalAuth = context => auth.syncLocalChannelAuth('claude', { channelId: context?.body?.channelId || context?.params?.channelId || context?.query?.channelId || '' });
  driver.getAuthQuota = context => auth.fetchChannelAuthQuota('claude', context?.params?.channelId, { refresh: context?.query?.refresh === 'true' });
  for (const name of [
    'getAllChannels', 'getCurrentChannel', 'getCurrentSettings', 'createChannel',
    'updateChannel', 'markChannelAsRecentlyUsed', 'deleteChannel',
    'applyChannelToSettings', 'getBestChannelForRestore', 'updateClaudeSettings',
    'updateClaudeSettingsWithModelConfig', 'extractApiKeyFromHelper',
    'syncCurrentClaudeChannel'
  ]) {
    driver[name] = (...args) => callLegacy(name, args);
  }
  return driver;
}

module.exports = { createDriver };
