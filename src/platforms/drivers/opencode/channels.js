'use strict';

const { createChannelDriver } = require('../shared/channel-driver');

function createDriver(context = {}) {
  return createChannelDriver({
    ...context,
    platform: 'opencode',
    servicePath: '../../server/services/opencode-channels',
    localServicePath: '../../../server/services/opencode-channels',
    syncMethod: 'syncCurrentOpenCodeChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.baseUrl, input.apiKey, input.extra || {}]
      : [input, ...rest]
  });
}

module.exports = { createDriver };
