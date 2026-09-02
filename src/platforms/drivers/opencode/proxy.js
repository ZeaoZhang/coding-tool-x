'use strict';

const { createProxyDriver } = require('../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'opencode',
    servicePath: '../../server/opencode-proxy-server',
    localServicePath: '../../../server/opencode-proxy-server',
    exports: { status: 'getOpenCodeProxyStatus', start: 'startOpenCodeProxyServer', stop: 'stopOpenCodeProxyServer' }
  });
}

module.exports = { createDriver };
