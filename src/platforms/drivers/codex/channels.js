'use strict';

const { createChannelDriver } = require('../shared/channel-driver');

function createDriver(context = {}) {
  return createChannelDriver({
    ...context,
    platform: 'codex',
    servicePath: '../../server/services/codex-channels',
    localServicePath: '../../../server/services/codex-channels',
    syncMethod: 'syncCurrentCodexChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.providerKey, input.baseUrl, input.apiKey, input.wireApi, input.extra || {}]
      : [input, ...rest]
  });
}

module.exports = { createDriver };
