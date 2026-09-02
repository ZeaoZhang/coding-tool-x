'use strict';

const { createChannelDriver } = require('../shared/channel-driver');

function createDriver(context = {}) {
  const driver = createChannelDriver({
    ...context,
    platform: 'codex',
    servicePath: './codex/channels-implementation',
    localServicePath: './channels-implementation',
    syncMethod: 'syncCurrentCodexChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.providerKey, input.baseUrl, input.apiKey, input.wireApi, input.extra || {}]
      : [input, ...rest]
  });
  const callLegacy = (name, args) => driver._service()[name](...args);
  for (const name of [
    'getChannels', 'getEnabledChannels', 'createChannel', 'updateChannel',
    'markChannelAsRecentlyUsed', 'deleteChannel', 'saveChannelOrder',
    'syncAllChannelEnvVars', 'writeCodexConfigForMultiChannel',
    'applyChannelToSettings', 'syncCurrentCodexChannel'
  ]) {
    driver[name] = (...args) => callLegacy(name, args);
  }
  return driver;
}

module.exports = { createDriver };

