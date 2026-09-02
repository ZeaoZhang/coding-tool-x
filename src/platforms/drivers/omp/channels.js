'use strict';

const { createChannelDriver } = require('../shared/channel-driver');

function createDriver(context = {}) {
  return createChannelDriver({
    ...context,
    platform: 'omp',
    servicePath: '../../server/services/omp-channels',
    localServicePath: '../../../server/services/omp-channels',
    syncMethod: 'syncCurrentOmpChannel',
    createArgs: (input, rest) => typeof input === 'object'
      ? [input.name, input.baseUrl, input.apiKey, input.extra || {}]
      : [input, ...rest]
  });
}

module.exports = { createDriver };
