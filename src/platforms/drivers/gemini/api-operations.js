'use strict';

const { createApiOperationsDriver } = require('../../../shared/driver-factories/api');

function createDriver(context = {}) {
  return createApiOperationsDriver({ ...context, platform: 'gemini' });
}

module.exports = { createDriver };
