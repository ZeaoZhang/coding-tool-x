'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'opencode',
    capability: 'sessions',
    servicePath: './opencode/sessions-implementation',
    localServicePath: '../opencode/sessions-implementation',
    methods: {
      getProjects: 'getProjects',
      recent: 'getRecentSessions',
      search: 'searchSessions',
      getSessionById: 'getSessionById',
      delete: 'deleteSession',
      fork: 'forkSession',
      saveSessionOrder: 'saveSessionOrder',
      status: 'getSessionStatus',
      isAvailable: 'isOpenCodeInstalled'
    },
    customMethods: {
      listSessions: (service, ...args) => {
        const method = service.getSessionsByProjectId || service.getSessionsByProject;
        if (typeof method !== 'function') return undefined;
        return method.apply(service, args);
      },
      messages: (service, sessionId) => {
        if (typeof service.getSessionMessages === 'function') {
          return service.getSessionMessages(sessionId);
        }
        const session = typeof service.getSessionById === 'function'
          ? service.getSessionById(sessionId)
          : null;
        return session?.messages || [];
      }
    }
  });
}

module.exports = { createDriver };
