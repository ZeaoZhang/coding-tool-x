'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'gemini',
    capability: 'sessions',
    parserVersion: 1,
    servicePath: './gemini/sessions-implementation',
    localServicePath: '../platforms/drivers/gemini/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/gemini/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {
      listSessions: 'getProjectSessions',
      recent: 'getRecentSessions',
      search: 'searchSessions',
      getSessionById: 'getSessionById',
      getAllSessions: 'getAllSessions',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      getProjectPath: 'getProjectPath',
      status: 'getSessionStatus',
      messages: 'getSessionMessages'
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('gemini');
      }
    }
  });
}

module.exports = { createDriver };
