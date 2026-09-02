'use strict';

const { createChannelDriver } = require('../shared/channel-driver');

function createDriver(context = {}) {
  return createChannelDriver({
    ...context,
    platform: 'gemini',
    servicePath: '../../server/services/gemini-channels',
    localServicePath: '../../../server/services/gemini-channels',
    syncMethod: 'syncCurrentGeminiChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.baseUrl, input.apiKey, input.model, input.extra || {}]
      : [input, ...rest]
  });
}

module.exports = { createDriver };
