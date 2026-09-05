'use strict';

const { createChannelDriver } = require('../../../shared/channel-driver');
const { ok, failed } = require('../../../shared/driver-result');

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
  driver.catalogMetadata = ({ body = {} } = {}) => {
    const operation = 'catalogMetadata';
    try {
      const value = driver._service().getCatalogMetadata(body);
      const wrap = result => (
        result && typeof result.status === 'string'
          ? result
          : ok('omp', 'channels', operation, result)
      );
      return value && typeof value.then === 'function'
        ? value.then(wrap).catch(error => failed('omp', 'channels', operation, error))
        : wrap(value);
    } catch (error) {
      return failed('omp', 'channels', operation, error);
    }
  };
  const auth = require('../../channel-auth-service');
  driver.getAuth = context => auth.getChannelAuth('omp', { channelId: context?.params?.channelId || context?.query?.channelId || '' });
  driver.syncLocalAuth = context => auth.syncLocalChannelAuth('omp', { channelId: context?.body?.channelId || context?.params?.channelId || context?.query?.channelId || '' });
  driver.getAuthQuota = context => auth.fetchChannelAuthQuota('omp', context?.params?.channelId, { refresh: context?.query?.refresh === 'true' });
  return driver;
}

module.exports = { createDriver };
