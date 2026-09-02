'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'opencode',
    capability: 'statistics',
    servicePath: '../../server/services/opencode-statistics-service',
    localServicePath: '../../../server/services/opencode-statistics-service',
    methods: {"getStatistics":"getStatistics","getDailyStatistics":"getDailyStatistics","getTodayStatistics":"getTodayStatistics","recordRequest":"recordRequest","resetStatistics":"resetStatistics"}
  });
}

module.exports = { createDriver };
