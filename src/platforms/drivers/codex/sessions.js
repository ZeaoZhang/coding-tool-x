'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'codex',
    capability: 'sessions',
    parserVersion: 2,
    servicePath: './codex/sessions-implementation',
    localServicePath: '../platforms/drivers/codex/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/codex/session-history-adapter',
    adapterMethods: { inventory: 'inventory', summarize: 'summarize', parse: 'parse' },
    methods: {
      listSessions: 'getSessionsByProject',
      listSessionsPage: 'getSessionsPage',
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
    customMethods: {
      searchAcrossProjects: (service, requestOrKeyword, limit, options = {}) => {
        if (requestOrKeyword && typeof requestOrKeyword === 'object' && !Array.isArray(requestOrKeyword)) {
          const request = requestOrKeyword;
          const query = request.query || {};
          return service.searchSessions(query.keyword || query.q || '', {
            ...request,
            ...options,
            projectName: query.projectName || query.project || null,
            limit: Number.parseInt(query.limit, 10) || 35,
            contextLength: Number(query.context) || 35
          });
        }
        return service.searchSessions(requestOrKeyword, { ...options, limit });
      }
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('codex');
      }
    }
  });
}

module.exports = { createDriver };
