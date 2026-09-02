'use strict';

const { createProxyDriver } = require('../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'codex',
    servicePath: '../../server/codex-proxy-server',
    localServicePath: '../../../server/codex-proxy-server',
    exports: { status: 'getCodexProxyStatus', start: 'startCodexProxyServer', stop: 'stopCodexProxyServer' },
    cliMetadata: { defaultPort: 20089 }
  });
}

module.exports = { createDriver };
