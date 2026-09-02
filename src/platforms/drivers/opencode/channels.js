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
      : [input, ...rest],
    cliMetadata: {
      supportsCliCreate: true,
      supportsCliToggle: true,
      defaultPort: 20091,
      createQuestions: [
        {
          type: 'input',
          name: 'wireApi',
          message: 'Wire API (默认: openai):',
          default: 'openai'
        },
        {
          type: 'input',
          name: 'model',
          message: '默认模型（可选，直接回车跳过）:'
        }
      ]
    },
  });
}

module.exports = { createDriver };
