'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'claude',
    capability: 'sessions',
    preservePayloadUpdatedAt: true,
    servicePath: './claude/sessions-implementation',
    localServicePath: '../platforms/drivers/claude/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/claude/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {
      launch: 'launch',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      getSessionOrder: 'getSessionOrder',
      parseRealProjectPath: 'parseRealProjectPath',
      hasActualMessages: 'hasActualMessages',
      status: 'getSessionStatus',
      messages: 'getSessionMessages'
    },
    customMethods: {
      listSessions: (service, projectName, options = {}) => service.getSessionsForProject(
        options.config || {},
        projectName,
        options
      ),
      recent: (service, limit, options = {}) => service.getRecentSessions(
        options.config || {},
        limit,
        options
      ),
      search: (service, projectName, keyword, contextLength, options = {}) => service.searchSessions(
        options.config || {},
        projectName,
        keyword,
        contextLength,
        options
      ),
      searchAcrossProjects: (service, keyword, limit, options = {}) => service.searchSessionsAcrossProjects(
        options.config || {},
        keyword,
        limit
      )
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('claude');
      }
    }
  });
}

module.exports = { createDriver };
