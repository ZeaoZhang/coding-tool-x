'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'gemini',
    capability: 'sessions',
    parserVersion: 2,
    servicePath: './gemini/sessions-implementation',
    localServicePath: '../platforms/drivers/gemini/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/gemini/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {
      listSessions: 'getProjectSessions',
      recent: 'getRecentSessions',
      getSessionById: 'getSessionById',
      getAllSessions: 'getAllSessions',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      getProjectPath: 'getProjectPath',
      status: 'getSessionStatus',
      messages: 'getSessionMessages'
    },
    customMethods: {
      search: (service, projectName, keyword, contextLength, options = {}) => service.searchSessions(
        keyword,
        contextLength,
        { ...options, projectName }
      ),
      searchAcrossProjects: (service, keyword, contextLength, options = {}) => service.searchSessions(
        keyword,
        contextLength,
        options
      )
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('gemini');
      }
    }
  });
}

module.exports = { createDriver };
