'use strict';

const { createProxyDriver } = require('../../../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'dsh',
    servicePath: './dsh/proxy-implementation',
    localServicePath: '../platforms/drivers/dsh/proxy-implementation',
    exports: {
      status: 'getDshProxyStatus',
      start: 'startDshProxyServer',
      stop: 'stopDshProxyServer'
    }
  });
}

module.exports = { createDriver };
