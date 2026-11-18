'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');
const { batchDeleteSessions } = require('../../../shared/session-batch-delete');

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
      batchDelete: async (service, projectName, sessionIds) => {
        const result = await batchDeleteSessions({
          sessionIds,
          deleteOne: sessionId => service.deleteSession(sessionId)
        });
        context.sessionHistoryIndex?.invalidateSource('codex');
        return result;
      },
      search: (service, requestOrProjectName, keyword, contextLength, options = {}) => {
        if (requestOrProjectName && typeof requestOrProjectName === 'object' && !Array.isArray(requestOrProjectName)) {
          const request = requestOrProjectName;
          const query = request.query || {};
          return service.searchSessions(query.keyword || query.q || query.query || '', {
            ...request,
            ...options,
            projectName: request.params?.projectName || null,
            limit: Number.parseInt(query.limit, 10) || 100,
            contextLength: Number(query.context) || 15
          });
        }
        if (keyword && typeof keyword === 'object' && !Array.isArray(keyword)) {
          return service.searchSessions(requestOrProjectName, keyword);
        }
        return service.searchSessions(keyword, {
          ...options,
          projectName: requestOrProjectName || null,
          limit: Number.parseInt(options.limit, 10) || 100,
          contextLength: Number(contextLength) || 15
        });
      },
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
