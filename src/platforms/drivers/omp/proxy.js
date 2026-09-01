'use strict';

const { createProxyDriver } = require('../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'omp',
    servicePath: '../../server/omp-proxy-server',
    localServicePath: '../../../server/omp-proxy-server',
    exports: { status: 'getOmpProxyStatus', start: 'startOmpProxyServer', stop: 'stopOmpProxyServer' }
  });
}

module.exports = { createDriver };
