'use strict';

const { createChannelDriver } = require('../shared/channel-driver');

function createDriver(context = {}) {
  const driver = createChannelDriver({
    ...context,
    platform: 'claude',
    servicePath: './claude/channels-implementation',
    localServicePath: './channels-implementation',
    listMethod: 'getAllChannels',
    syncMethod: 'syncCurrentClaudeChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.baseUrl, input.apiKey, input.websiteUrl, input.extra || {}]
      : [input, ...rest],
    cliMetadata: { supportsCliCreate: true, supportsCliToggle: true, defaultPort: 20088 }
  });
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
