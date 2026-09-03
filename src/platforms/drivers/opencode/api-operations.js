'use strict';

const { createApiOperationsDriver } = require('../../../shared/driver-factories/api');

function createDriver(context = {}) {
  return createApiOperationsDriver({ ...context, platform: 'opencode' });
}

module.exports = { createDriver };
