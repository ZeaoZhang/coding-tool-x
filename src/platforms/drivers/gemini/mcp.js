'use strict';

const { createMcpDriver } = require('../../../shared/driver-factories/mcp');

function createDriver(context = {}) {
  return createMcpDriver({ ...context, platform: 'gemini' });
}

module.exports = { createDriver };
