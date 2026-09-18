'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');

function createDriver(context = {}) {
  const driver = createChannelDriver({
    ...context,
    platform: 'opencode',
    servicePath: './opencode/channels-implementation',
    localServicePath: '../opencode/channels-implementation',
    syncMethod: 'syncCurrentOpenCodeChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? (() => {
        const { name, baseUrl, apiKey, extra, ...channelExtra } = input;
        return [name, baseUrl, apiKey, { ...channelExtra, ...extra }];
      })()
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
    dashboardChannelShape: 'array'
  });
  const auth = require('../../channel-auth-service');
  driver.getAuth = context => auth.getChannelAuth('opencode', { channelId: context?.params?.channelId || context?.query?.channelId || '' });
  driver.syncLocalAuth = context => auth.syncLocalChannelAuth('opencode', { channelId: context?.body?.channelId || context?.params?.channelId || context?.query?.channelId || '' });
  driver.getAuthQuota = context => auth.fetchChannelAuthQuota('opencode', context?.params?.channelId, { refresh: context?.query?.refresh === 'true' });
  return driver;
}

module.exports = { createDriver };
