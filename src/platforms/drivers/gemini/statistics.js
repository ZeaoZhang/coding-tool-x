'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'gemini',
    capability: 'statistics',
    servicePath: './gemini/statistics-implementation',
    localServicePath: '../gemini/statistics-implementation',
    methods: {"getStatistics":"getStatistics","getDailyStatistics":"getDailyStatistics","getTodayStatistics":"getTodayStatistics","recordRequest":"recordRequest","resetStatistics":"resetStatistics"}
  });
}

module.exports = { createDriver };
