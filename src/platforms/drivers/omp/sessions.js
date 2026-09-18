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
    adapterMethods: { inventory: 'inventory', summarize: 'summarize', parse: 'parse' },
    methods: {
      getProjects: 'getProjects',
      listSessions: 'getSessionsByProject',
      listSessionsPage: 'getSessionsPage',
      recent: 'getRecentSessions',
      getSessionById: 'getSessionById',
      messages: 'getSessionMessages',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      buildLaunchCommand: 'buildLaunchCommand',
      status: 'getSessionStatus'
    },
    customMethods: {
      search: (service, requestOrProjectName, keyword, contextLength, options = {}) => {
        if (requestOrProjectName && typeof requestOrProjectName === 'object' && !Array.isArray(requestOrProjectName)) {
          const request = requestOrProjectName;
          const query = request.query || {};
          return service.searchSessions(query.keyword || query.q || '', Number(query.context) || 15, {
            ...request,
            ...options,
            projectName: request.params?.projectName || null,
            limit: Number.parseInt(query.limit, 10) || 100
          });
        }
        return service.searchSessions(keyword, contextLength, {
          ...options,
          projectName: requestOrProjectName
        });
      },
      searchAcrossProjects: (service, requestOrKeyword, limit, options = {}) => {
        if (requestOrKeyword && typeof requestOrKeyword === 'object' && !Array.isArray(requestOrKeyword)) {
          const request = requestOrKeyword;
          const query = request.query || {};
          return service.searchSessions(query.keyword || query.q || '', Number(query.context) || 35, {
            ...request,
            ...options,
            projectName: query.projectName || query.project || null,
            limit: Number.parseInt(query.limit, 10) || 35
          });
        }
        return service.searchSessions(requestOrKeyword, Number(options.contextLength) || 35, { ...options, limit });
      }
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('omp');
      }
    }
  });
}

module.exports = { createDriver };
