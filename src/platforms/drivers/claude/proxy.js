'use strict';

const { createProxyDriver } = require('../../../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'claude',
    servicePath: './claude/proxy-implementation',
    localServicePath: '../platforms/drivers/claude/proxy-implementation',
    exports: { status: 'getProxyStatus', start: 'startProxyServer', stop: 'stopProxyServer' },
    cliMetadata: { defaultPort: 20088 }
  });
}

module.exports = { createDriver };
