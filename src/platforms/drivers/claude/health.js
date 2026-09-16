'use strict';

const { healthCheckAllProjects } = require('./health-check');

function createDriver(context = {}) {
  return {
    platform: context.platform,
    capability: 'health',
    async healthCheck({ detail = true } = {}) {
      const projects = context.sessionHistoryIndex
        ? await context.sessionHistoryIndex.listProjects(context.platform, { consistency: 'stale-ok' })
        : [];
      return {
        success: true,
        timestamp: new Date().toISOString(),
        ...healthCheckAllProjects(projects, { includeResults: detail })
      };
    }
  };
}

module.exports = { createDriver };
