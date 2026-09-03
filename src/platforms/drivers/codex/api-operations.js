'use strict';

const { createApiOperationsDriver } = require('../../../shared/driver-factories/api');

function createDriver(context = {}) {
  return createApiOperationsDriver({ ...context, platform: 'codex' });
}

module.exports = { createDriver };
