'use strict';

const { createProxyDriver } = require('../shared/proxy-driver');

function createDriver(context = {}) {
  return createProxyDriver({
    ...context,
    platform: 'gemini',
    servicePath: './gemini/proxy-implementation',
    localServicePath: '../gemini/proxy-implementation',
    exports: { status: 'getGeminiProxyStatus', start: 'startGeminiProxyServer', stop: 'stopGeminiProxyServer' },
    cliMetadata: { defaultPort: 20090 }
  });
}

module.exports = { createDriver };
