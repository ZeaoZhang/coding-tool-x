'use strict';

const { createProxyDriver } = require('../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'opencode',
    servicePath: './opencode/proxy-implementation',
    localServicePath: '../opencode/proxy-implementation',
    exports: { status: 'getOpenCodeProxyStatus', start: 'startOpenCodeProxyServer', stop: 'stopOpenCodeProxyServer' },
    cliMetadata: { defaultPort: 20091 }
  });
}

module.exports = { createDriver };
