'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'claude',
    capability: 'sessions',
    parserVersion: 2,
    servicePath: './claude/sessions-implementation',
    localServicePath: '../platforms/drivers/claude/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/claude/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {
      launch: 'launch',
      saveSessionOrder: 'saveSessionOrder',
      getSessionOrder: 'getSessionOrder',
      parseRealProjectPath: 'parseRealProjectPath',
      hasActualMessages: 'hasActualMessages',
      status: 'getSessionStatus',
      messages: 'getSessionMessages'
    },
    customMethods: {
      delete: (service, projectName, sessionId, options = {}) => {
        const result = service.deleteSession(options.config || {}, projectName, sessionId);
        context.sessionHistoryIndex?.invalidateSource('claude');
        return result;
      },
      fork: (service, projectName, sessionId, options = {}) => {
        const result = service.forkSession(options.config || {}, projectName, sessionId, options);
        context.sessionHistoryIndex?.invalidateSource('claude');
        return result;
      },
      listSessions: (service, projectNameOrRequest, options = {}) => {
        const descriptorRequest = projectNameOrRequest && typeof projectNameOrRequest === 'object';
        const request = descriptorRequest ? projectNameOrRequest : options;
        const projectName = descriptorRequest
          ? request.params?.projectName
          : projectNameOrRequest;
        return service.getSessionsForProject(
          request.config || {},
          projectName,
          request
        );
      },
      recent: (service, limitOrRequest, options = {}) => {
        const descriptorRequest = limitOrRequest && typeof limitOrRequest === 'object';
        const request = descriptorRequest ? limitOrRequest : options;
        const limit = descriptorRequest
          ? Number.parseInt(request.query?.limit, 10) || 5
          : limitOrRequest;
        return service.getRecentSessions(request.config || {}, limit, request);
      },
      search: (service, projectName, keyword, contextLength, options = {}) => service.searchSessions(
        options.config || {},
        projectName,
        keyword,
        contextLength,
        options
      ),
      searchAcrossProjects: (service, keyword, limit, options = {}) => service.searchSessionsAcrossProjects(
        options.config || {},
        keyword,
        limit
      )
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('claude');
      }
    }
  });
}

module.exports = { createDriver };
