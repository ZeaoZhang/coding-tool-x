'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'codex',
    capability: 'sessions',
    preservePayloadUpdatedAt: true,
    servicePath: './codex/sessions-implementation',
    localServicePath: '../platforms/drivers/codex/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/codex/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {
      listSessions: 'getSessionsByProject',
      recent: 'getRecentSessions',
      search: 'searchSessions',
      getSessionById: 'getSessionById',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      getSessionOrder: 'getSessionOrder',
      getProjectOrder: 'getProjectOrder',
      status: 'getSessionStatus',
      messages: 'getSessionMessages'
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('codex');
      }
    }
  });
}

module.exports = { createDriver };
