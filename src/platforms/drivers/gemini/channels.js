'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');

function createDriver(context = {}) {
  return createChannelDriver({
    ...context,
    platform: 'gemini',
    servicePath: './gemini/channels-implementation',
    localServicePath: '../platforms/drivers/gemini/channels-implementation',
    syncMethod: 'syncCurrentGeminiChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.baseUrl, input.apiKey, input.model, input.extra || {}]
      : [input, ...rest],
    cliMetadata: {
      supportsCliCreate: true,
      supportsCliToggle: true,
      defaultPort: 20090,
      createDefaults: { model: 'gemini-2.5-pro' },
      createQuestions: [{
        type: 'input',
        name: 'model',
        message: '模型名称 (默认: gemini-2.5-pro):',
        default: 'gemini-2.5-pro'
      }]
    },
    formatCliChannelDetails: channel => channel.model ? [`model ${channel.model}`] : []
  });
}

module.exports = { createDriver };
