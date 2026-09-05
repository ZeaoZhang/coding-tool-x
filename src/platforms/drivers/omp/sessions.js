'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'omp',
    capability: 'sessions',
    parserVersion: 2,
    servicePath: './omp/sessions-implementation',
    localServicePath: '../platforms/drivers/omp/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/omp/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {
      getProjects: 'getProjects',
      listSessions: 'getSessionsByProject',
      recent: 'getRecentSessions',
      search: 'searchSessions',
      getSessionById: 'getSessionById',
      messages: 'getSessionMessages',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      buildLaunchCommand: 'buildLaunchCommand',
      status: 'getSessionStatus'
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('omp');
      }
    }
  });
}

module.exports = { createDriver };
