'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');

function createDriver(context = {}) {
  return createChannelDriver({
    ...context,
    platform: 'omp',
    servicePath: './omp/channels-implementation',
    localServicePath: '../platforms/drivers/omp/channels-implementation',
    syncMethod: 'syncCurrentOmpChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.baseUrl, input.apiKey, input.extra || {}]
      : [input, ...rest],
    cliMetadata: {
      supportsCliCreate: false,
      supportsCliToggle: true,
      managedProviderConfig: true,
      defaultPort: 20092,
      createUnavailableMessage: '提示: OMP 渠道请通过 Web UI 或 API 添加后，再在这里启停调度。'
    }
  });
}

module.exports = { createDriver };
