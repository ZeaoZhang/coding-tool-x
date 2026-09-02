'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'claude',
    capability: 'statistics',
    servicePath: './claude/statistics-implementation',
    localServicePath: '../claude/statistics-implementation',
    methods: {"getStatistics":"getStatistics","getDailyStatistics":"getDailyStatistics","getTodayStatistics":"getTodayStatistics","recordRequest":"recordRequest","resetStatistics":"resetStatistics"}
  });
}

module.exports = { createDriver };
