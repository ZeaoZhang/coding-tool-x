'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'opencode',
    capability: 'statistics',
    servicePath: './opencode/statistics-implementation',
    localServicePath: '../opencode/statistics-implementation',
    methods: {"getStatistics":"getStatistics","getDailyStatistics":"getDailyStatistics","getTodayStatistics":"getTodayStatistics","recordRequest":"recordRequest","resetStatistics":"resetStatistics"}
  });
}

module.exports = { createDriver };
