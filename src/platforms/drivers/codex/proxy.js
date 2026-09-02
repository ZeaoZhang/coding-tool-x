'use strict';

const { createProxyDriver } = require('../../../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'codex',
    servicePath: './codex/proxy-implementation',
    localServicePath: '../platforms/drivers/codex/proxy-implementation',
    exports: { status: 'getCodexProxyStatus', start: 'startCodexProxyServer', stop: 'stopCodexProxyServer' },
    cliMetadata: { defaultPort: 20089 }
  });
}

module.exports = { createDriver };
