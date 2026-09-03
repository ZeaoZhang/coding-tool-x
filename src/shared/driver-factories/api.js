'use strict';

function resultFor(context, status, data, error, cause) {
  const result = {
    status,
    platform: context.platform,
    capability: context.route?.capability || 'api',
    operation: context.route?.operation || context.operation
  };
  if (status === 'ok') result.data = data;
  if (error) result.error = typeof error === 'string' ? error : error.message || String(error);
  if (cause) Object.defineProperty(result, 'cause', { value: cause, enumerable: false });
  return result;
}

function optionsFor(context) {
  return {
    ...(context.query || {}),
    config: context.config,
    force: context.query?.fresh === '1' || context.query?.fresh === 'true'
  };
}

function argsFor(capability, operation, context) {
  const params = context.params || {};
  const options = optionsFor(context);
  const withConfig = args => context.platform === 'claude' ? [context.config, ...args] : args;
  if (capability === 'projects') {
    if (operation === 'listProjects') return [options];
    if (operation === 'deleteProject') return [params.projectName, options];
    if (operation === 'saveProjectOrder') return [context.body?.order || context.body, options];
    if (operation === 'createProject') return [context.body || {}, options];
  }
  if (capability === 'sessions') {
    const projectName = params.projectName;
    if (operation === 'recent') return withConfig([Number(context.query?.limit) || undefined, options]);
    if (operation === 'searchAcrossProjects') return withConfig([context.query?.q || context.query?.query || '', Number(context.query?.limit) || undefined, options]);
    if (operation === 'listSessions') return withConfig([projectName, options]);
    if (operation === 'search') {
      return withConfig([projectName, context.query?.q || context.query?.query || '', Number(context.query?.context) || 15, options]);
    }
    if (['status', 'outline', 'messages', 'delete', 'fork', 'launch'].includes(operation)) {
      return [params.sessionId, context.body || options];
    }
    if (operation === 'batchDelete') return withConfig([projectName, context.body?.sessionIds || context.body?.ids || [], options]);
    if (operation === 'createSession') return withConfig([projectName, context.body || {}, options]);
    if (operation === 'saveSessionOrder') return withConfig([projectName, context.body?.order || context.body, options]);
  }
  if (capability === 'channels') {
    if (operation === 'list' || operation === 'enabled' || operation === 'current' || operation === 'bestForRestore') return [options];
    if (operation === 'create') return [context.body || {}];
    if (operation === 'update') return [params.channelId, context.body || {}];
    if (operation === 'remove') return [params.channelId];
    if (operation === 'models') return [params.channelId, options];
    if (operation === 'applyToSettings') return [params.channelId];
    return [context.body || options];
  }
  if (capability === 'proxy') return [options];
  if (capability === 'statistics') {
    if (operation === 'daily') return [params.date || context.query?.date, options];
    return [options];
  }
  return [context];
}
const TARGET_OPERATIONS = Object.freeze({
  channels: Object.freeze({
    enabled: 'getEnabled',
    current: 'getCurrentChannel',
    bestForRestore: 'getBestChannelForRestore',
    sync: 'syncCurrent',
    order: 'saveOrder',
    applyToSettings: 'applyNativeConfig'
  }),
  statistics: Object.freeze({
    summary: 'getStatistics',
    today: 'getTodayStatistics',
    daily: 'getDailyStatistics'
  })
});

function targetOperation(capability, operation) {
  return TARGET_OPERATIONS[capability]?.[operation] || operation;
}

function createApiOperationsDriver({ platform, runtime, manifest, config, sessionHistoryIndex, operationHandlers = {} } = {}) {
  const driver = { platform, capability: 'api' };
  const operations = new Set();
  for (const route of manifest?.api?.routes || []) operations.add(route.operation);
  const routeByOperation = new Map((manifest?.api?.routes || []).map(route => [route.operation, route]));

  const decorateReadModel = async (capability, operation, value) => {
    if (capability !== 'projects' && capability !== 'sessions') return value;
    const isProjectList = capability === 'projects' && operation === 'listProjects';
    const isSessionList = capability === 'sessions' && ['listSessions', 'recent', 'search', 'searchAcrossProjects'].includes(operation);
    if (!isProjectList && !isSessionList) return value;
    const payload = Array.isArray(value)
      ? (isProjectList ? { projects: value } : { sessions: value })
      : { ...(value && typeof value === 'object' ? value : {}) };
    if (isProjectList && !Array.isArray(payload.projects)) payload.projects = [];
    if (isSessionList && !Array.isArray(payload.sessions)) payload.sessions = [];
    if (!payload.meta && typeof sessionHistoryIndex?.getSourceIndexMeta === 'function') {
      payload.meta = sessionHistoryIndex.getSourceIndexMeta(platform);
    }
    if (isProjectList && !Object.prototype.hasOwnProperty.call(payload, 'currentProject')) {
      payload.currentProject = platform === 'claude' ? config?.currentProject || null : null;
    }
    return payload;
  };

  for (const operation of operations) {
    driver[operation] = async context => {
      const route = context.route || routeByOperation.get(operation);
      const requestContext = route && !context.route ? { ...context, route } : context;
      const capability = route?.capability;
      try {
        const handler = operationHandlers[operation];
        if (typeof handler === 'function') {
          return resultFor(requestContext, 'ok', await handler(requestContext, { config, runtime, sessionHistoryIndex }));
        }
        if (capability === 'sessions' && sessionHistoryIndex) {
          const index = sessionHistoryIndex;
          const sessionId = requestContext.params?.sessionId;
          const indexCall = operation === 'status'
            ? index.getSessionStatus?.(platform, sessionId, { consistency: 'stale-ok' })
            : operation === 'outline'
              ? index.getSessionOutline?.(platform, sessionId, { consistency: 'stale-ok' })
              : operation === 'messages'
                ? index.getMessagePage?.(platform, sessionId, Number(requestContext.query?.page) || 1, Number(requestContext.query?.limit) || 50, { consistency: 'stale-ok' })
                : null;
          if (indexCall) return resultFor(requestContext, 'ok', await indexCall);
        }
        const target = runtime?.getDriver?.(platform, capability, {
          config: requestContext.config ?? config,
          manifest,
          route
        });
        const operationName = targetOperation(capability, operation);
        if (!target || typeof target[operationName] !== 'function') {
          return resultFor(requestContext, 'unsupported');
        }
        const value = await target[operationName](...argsFor(capability, operation, requestContext));
        if (value && typeof value === 'object' && typeof value.status === 'string') {
          if (value.status !== 'ok') return resultFor(requestContext, value.status, undefined, value.error, value.cause);
          return resultFor(requestContext, 'ok', await decorateReadModel(capability, operation, value.data));
        }
        return resultFor(requestContext, 'ok', await decorateReadModel(capability, operation, value));
      } catch (error) {
        return resultFor(requestContext, 'failed', undefined, error, error);
      }
    };
  }

  return driver;
}

module.exports = { createApiOperationsDriver };
