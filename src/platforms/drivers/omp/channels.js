'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');

function createDriver(context = {}) {
  const driver = createChannelDriver({
    ...context,
    platform: 'omp',
    servicePath: './omp/channels-implementation',
    localServicePath: '../platforms/drivers/omp/channels-implementation',
    syncMethod: 'syncCurrentOmpChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? (() => {
        const { name, baseUrl, apiKey, extra, ...channelExtra } = input;
        return [name, baseUrl, apiKey, { ...channelExtra, ...extra }];
      })()
      : [input, ...rest],
    cliMetadata: {
      supportsCliCreate: false,
      supportsCliToggle: true,
      managedProviderConfig: true,
      defaultPort: 20092,
      createUnavailableMessage: '提示: OMP 渠道请通过 Web UI 或 API 添加后，再在这里启停调度。'
    },
    dashboardChannelShape: 'array'
  });
  driver.syncManagedProviderExtension = (...args) => (
    driver._service().syncManagedProviderExtension(...args)
  );
  return driver;
}

module.exports = { createDriver };
