'use strict';

const { healthCheckAllProjects } = require('./health-check');

function createDriver(context = {}) {
  return {
    platform: context.platform,
    capability: 'health',
    async healthCheck() {
      const projects = context.sessionHistoryIndex
        ? await context.sessionHistoryIndex.listProjects(context.platform, { consistency: 'stale-ok' })
        : [];
      return {
        success: true,
        timestamp: new Date().toISOString(),
        ...healthCheckAllProjects(projects)
      };
    }
  };
}

module.exports = { createDriver };
