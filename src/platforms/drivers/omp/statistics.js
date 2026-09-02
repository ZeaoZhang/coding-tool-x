'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'omp',
    capability: 'statistics',
    servicePath: './omp/statistics-implementation',
    localServicePath: '../omp/statistics-implementation',
    methods: {"getStatistics":"getStatistics","getDailyStatistics":"getDailyStatistics","getTodayStatistics":"getTodayStatistics","recordRequest":"recordRequest","resetStatistics":"resetStatistics"}
  });
}

module.exports = { createDriver };
