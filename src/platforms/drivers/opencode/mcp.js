'use strict';

const { createMcpDriver } = require('../shared/mcp');

function createDriver(context = {}) {
  return createMcpDriver({ ...context, platform: 'opencode' });
}

module.exports = { createDriver };
