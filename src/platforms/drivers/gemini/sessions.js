'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');
const { batchDeleteSessions } = require('../../../shared/session-batch-delete');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'gemini',
    capability: 'sessions',
    parserVersion: 3,
    servicePath: './gemini/sessions-implementation',
    localServicePath: '../platforms/drivers/gemini/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/gemini/session-history-adapter',
    adapterMethods: { inventory: 'inventory', summarize: 'summarize', parse: 'parse' },
    methods: {
      listSessions: 'getProjectSessions',
      listSessionsPage: 'getProjectSessionsPage',
      recent: 'getRecentSessions',
      getSessionById: 'getSessionById',
      launchCommand: 'getSessionLaunchCommand',
      getAllSessions: 'getAllSessions',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      getProjectPath: 'getProjectPath',
      status: 'getSessionStatus',
      messages: 'getSessionMessages'
    },
    customMethods: {
      batchDelete: async (service, projectName, sessionIds) => {
        const result = await batchDeleteSessions({
          sessionIds,
          deleteOne: sessionId => service.deleteSession(sessionId)
        });
        context.sessionHistoryIndex?.invalidateSource('gemini');
        return result;
      },
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
