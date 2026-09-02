'use strict';

const { createProxyDriver } = require('../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'claude',
    servicePath: '../../server/proxy-server',
    localServicePath: '../../../server/proxy-server',
    exports: { status: 'getProxyStatus', start: 'startProxyServer', stop: 'stopProxyServer' }
  });
}

module.exports = { createDriver };
