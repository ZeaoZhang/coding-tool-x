'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'opencode',
    capability: 'sessions',
    servicePath: './opencode/sessions-implementation',
    localServicePath: '../platforms/drivers/opencode/sessions-implementation',
    methods: {
      getProjects: 'getProjects',
      recent: 'getRecentSessions',
      getSessionById: 'getSessionById',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      status: 'getSessionStatus',
      outline: 'getSessionOutline',
      isAvailable: 'isOpenCodeInstalled'
    },
    customMethods: {
      search: (service, requestOrProjectName, keyword, contextLength, options = {}) => {
        if (requestOrProjectName && typeof requestOrProjectName === 'object' && !Array.isArray(requestOrProjectName)) {
          const request = requestOrProjectName;
          const query = request.query || {};
          return service.searchSessions(query.keyword || query.q || '', {
            ...request,
            ...options,
            projectName: request.params?.projectName || null,
            contextLength: Number(query.context) || 15,
            limit: Number.parseInt(query.limit, 10) || 100
          });
        }
        return service.searchSessions(keyword, {
          ...options,
          projectName: requestOrProjectName,
          contextLength,
          limit: options.limit
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
      },
      listSessions: (service, ...args) => {
        const method = service.getSessionsByProjectId || service.getSessionsByProject;
        if (typeof method !== 'function') return undefined;
        return method.apply(service, args);
      },
      listSessionsPage: (service, projectName, options = {}) => {
        if (typeof service.getSessionsPage !== 'function') return undefined;
        return service.getSessionsPage(projectName, options);
      },
      messages: (service, sessionId, options) => {
        if (typeof service.getSessionMessages === 'function') {
          return service.getSessionMessages(sessionId, options);
        }
        const session = typeof service.getSessionById === 'function'
          ? service.getSessionById(sessionId)
          : null;
        return session?.messages || [];
      }
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('opencode');
      }
    }
  });
}

module.exports = { createDriver };
