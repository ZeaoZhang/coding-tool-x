'use strict';

const { createChannelDriver } = require('../shared/channel-driver');

function createDriver(context = {}) {
  return createChannelDriver({
    ...context,
    platform: 'claude',
    servicePath: '../../server/services/channels',
    localServicePath: '../../../server/services/channels',
    listMethod: 'getAllChannels',
    syncMethod: 'syncCurrentClaudeChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.baseUrl, input.apiKey, input.websiteUrl, input.extra || {}]
      : [input, ...rest]
  });
}

module.exports = { createDriver };
