'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'dsh',
    capability: 'statistics',
    servicePath: './dsh/statistics-implementation',
    localServicePath: '../platforms/drivers/dsh/statistics-implementation',
    methods: {
      summary: 'getStatistics',
      daily: 'getDailyStatistics',
      today: 'getTodayStatistics',
      getStatistics: 'getStatistics',
      getDailyStatistics: 'getDailyStatistics',
      getTodayStatistics: 'getTodayStatistics',
      recordRequest: 'recordRequest'
    }
  });
}

module.exports = { createDriver };
