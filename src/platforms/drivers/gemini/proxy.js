'use strict';

const { createProxyDriver } = require('../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'gemini',
    servicePath: '../../server/gemini-proxy-server',
    localServicePath: '../../../server/gemini-proxy-server',
    exports: { status: 'getGeminiProxyStatus', start: 'startGeminiProxyServer', stop: 'stopGeminiProxyServer' },
    cliMetadata: { defaultPort: 20090 }
  });
}

module.exports = { createDriver };
