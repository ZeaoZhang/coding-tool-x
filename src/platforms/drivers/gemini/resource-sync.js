'use strict';

const { createResourceSyncDriver } = require('../../../shared/driver-factories/resource-sync');

function createDriver(context = {}) {
  return createResourceSyncDriver({ ...context, platform: 'gemini' });
}

module.exports = { createDriver };
