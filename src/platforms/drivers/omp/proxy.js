'use strict';

const { createProxyDriver } = require('../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'omp',
    servicePath: './omp/proxy-implementation',
    localServicePath: '../omp/proxy-implementation',
    exports: { status: 'getOmpProxyStatus', start: 'startOmpProxyServer', stop: 'stopOmpProxyServer' },
    cliMetadata: { managedProviderConfig: true, defaultPort: 20092 }
  });
}

module.exports = { createDriver };
