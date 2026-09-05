'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');

function createDriver(context = {}) {
  const driver = createChannelDriver({
    ...context,
    platform: 'codex',
    servicePath: './codex/channels-implementation',
    localServicePath: '../platforms/drivers/codex/channels-implementation',
    syncMethod: 'syncCurrentCodexChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? (() => {
        const { name, providerKey, baseUrl, apiKey, wireApi, extra, ...channelExtra } = input;
        return [name, providerKey, baseUrl, apiKey, wireApi, { ...channelExtra, ...extra }];
      })()
      : [input, ...rest],
    cliMetadata: { supportsCliCreate: true, supportsCliToggle: true, defaultPort: 20089, createDefaults: { wireApi: 'responses' } },
    modelListType: 'openai_compatible',
    formatCliChannelDetails: channel => channel.providerKey
      ? [`provider ${channel.providerKey}`]
      : []
  });
  const auth = require('../../channel-auth-service');
  driver.getAuth = context => auth.getChannelAuth('codex', { channelId: context?.params?.channelId || context?.query?.channelId || '' });
  driver.syncLocalAuth = context => auth.syncLocalChannelAuth('codex', { channelId: context?.body?.channelId || context?.params?.channelId || context?.query?.channelId || '' });
  driver.getAuthQuota = context => auth.fetchChannelAuthQuota('codex', context?.params?.channelId, { refresh: context?.query?.refresh === 'true' });
  const callLegacy = (name, args) => driver._service()[name](...args);
  for (const name of [
    'getChannels', 'getEnabledChannels', 'createChannel', 'updateChannel',
    'markChannelAsRecentlyUsed', 'deleteChannel', 'saveChannelOrder',
    'syncAllChannelEnvVars', 'writeCodexConfigForMultiChannel',
    'applyChannelToSettings', 'syncCurrentCodexChannel'
  ]) {
    driver[name] = (...args) => callLegacy(name, args);
  }
  driver.writeMultiChannelConfig = channels => {
    const service = driver._service();
    return service.writeCodexConfigForMultiChannel(channels);
  };
  return driver;
}

module.exports = { createDriver };

