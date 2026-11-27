'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');
const { batchDeleteSessions } = require('../../../shared/session-batch-delete');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'claude',
    capability: 'sessions',
    parserVersion: 3,
    servicePath: './claude/sessions-implementation',
    localServicePath: '../platforms/drivers/claude/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/claude/session-history-adapter',
    adapterMethods: { inventory: 'inventory', summarize: 'summarize', parse: 'parse' },
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
      batchDelete: async (service, projectName, sessionIds, options = {}) => {
        const result = await batchDeleteSessions({
          sessionIds,
          deleteOne: sessionId => service.deleteSession(options.config || {}, projectName, sessionId)
        });
        context.sessionHistoryIndex?.invalidateSource('claude');
        return result;
      },
      // HTTP launch returns a copyable command; CLI resume keeps spawning.
      launchCommand: (service, sessionId, options = {}) => service.getSessionLaunchCommand(sessionId, {
        fork: options.fork === true,
        config: options.config || {},
        cwd: options.cwd
      }),
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
      listSessionsPage: (service, projectNameOrRequest, options = {}) => {
        const descriptorRequest = projectNameOrRequest && typeof projectNameOrRequest === 'object';
        const request = descriptorRequest ? projectNameOrRequest : options;
        const projectName = descriptorRequest
          ? request.params?.projectName
          : projectNameOrRequest;
        return service.getSessionsPage(request.config || {}, projectName, request);
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
      searchAcrossProjects: (service, requestOrKeyword, limit, options = {}) => {
        if (requestOrKeyword && typeof requestOrKeyword === 'object' && !Array.isArray(requestOrKeyword)) {
          const request = requestOrKeyword;
          const query = request.query || {};
          const requestLimit = Number.parseInt(query.limit, 10) || 35;
          return service.searchSessionsAcrossProjects(
            request.config || options.config || {},
            query.keyword || query.q || query.query || '',
            requestLimit,
            {
              ...request,
              ...options,
              config: request.config || options.config || {},
              projectName: query.projectName || query.project || null,
              limit: requestLimit,
              contextLength: Number(query.context) || 35
            }
          );
        }
        return service.searchSessionsAcrossProjects(options.config || {}, requestOrKeyword, limit, options);
      }
    },
    onSuccess: operation => {
      if (['delete', 'fork', 'saveSessionOrder'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('claude');
      }
    }
  });
}

module.exports = { createDriver };
