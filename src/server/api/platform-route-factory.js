'use strict';

const STATUS_CODES = Object.freeze({
  unsupported: 404,
  unavailable: 503,
  invalid: 400,
  failed: 500
});

const OPERATION_CANDIDATES = Object.freeze({
  projects: Object.freeze(['listProjects', 'getProjects', 'list']),
  sessions: Object.freeze(['listSessions', 'getSessions', 'list']),
  channels: Object.freeze(['list', 'getChannels']),
  proxy: Object.freeze(['status', 'getStatus'])
});

const ROUTES = Object.freeze([
  Object.freeze({
    path: '/:platform/projects',
    capability: 'projects',
    params: (req) => [{ force: req.query?.fresh === '1' }]
  }),
  Object.freeze({
    path: '/:platform/sessions/:projectName',
    capability: 'sessions',
    params: (req) => [req.params.projectName, { force: req.query?.fresh === '1' }]
  }),
  Object.freeze({
    path: '/:platform/channels',
    capability: 'channels',
    params: (req) => [{ force: req.query?.fresh === '1' }]
  }),
  Object.freeze({
    path: '/:platform/proxy/status',
    capability: 'proxy',
    params: (req) => [{ force: req.query?.fresh === '1' }]
  })
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).slice(0, 4096);
}

function getStatus(value) {
  return isObject(value) && typeof value.status === 'string' ? value.status : null;
}

function addContext(value, { platform, capability, operation }) {
  const result = isObject(value) ? { ...value } : {};
  if (result.platform == null) result.platform = platform;
  if (result.capability == null) result.capability = capability;
  if (result.operation == null) result.operation = operation;
  if (result.code == null && result.status && result.status !== 'ok') result.code = result.status;
  return result;
}

function stateResponse(res, value, context) {
  const status = getStatus(value);
  if (!status || !Object.prototype.hasOwnProperty.call(STATUS_CODES, status)) {
    return false;
  }

  const result = addContext(value, context);
  if (status === 'ok') {
    return res.status(200).json(Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result);
  }
  return res.status(STATUS_CODES[status]).json({ error: result });
}

function makeFailure(context, error) {
  const cause = error instanceof Error ? error : new Error(safeText(error, 'Platform route failed'));
  const result = {
    status: 'failed',
    code: 'failed',
    platform: context.platform,
    capability: context.capability,
    operation: context.operation,
    error: safeText(cause.message, 'Platform route failed')
  };
  Object.defineProperty(result, 'cause', { value: cause, enumerable: false });
  return result;
}

function makeUnsupported(context) {
  return {
    status: 'unsupported',
    code: 'unsupported',
    platform: context.platform,
    capability: context.capability,
    operation: context.operation
  };
}

function resolvePlatform(registry, key) {
  if (!registry || typeof registry.resolve !== 'function') return null;
  return registry.resolve(key);
}

function getDeclaredCapability(registry, platform, definition, capability) {
  if (registry && typeof registry.getCapability === 'function') {
    return registry.getCapability(platform, capability);
  }
  if (definition && definition.capabilities && Object.prototype.hasOwnProperty.call(definition.capabilities, capability)) {
    return definition.capabilities[capability];
  }
  return undefined;
}

function findOperation(driver, capability) {
  const names = OPERATION_CANDIDATES[capability] || [];
  for (const name of names) {
    if (typeof driver?.[name] === 'function') return name;
  }
  return null;
}

async function invokeCapability({ registry, runtime, request, response, route }) {
  const platform = String(request.params.platform || '').trim().toLowerCase();
  const operation = OPERATION_CANDIDATES[route.capability]?.[0] || 'invoke';
  const context = { platform, capability: route.capability, operation };
  const definition = resolvePlatform(registry, platform);

  if (!definition) {
    return response.status(404).json({
      error: {
        status: 'invalid',
        code: 'not_found',
        platform,
        capability: route.capability,
        operation,
        error: `Unknown platform: ${platform}`
      }
    });
  }

  const declaredCapability = getDeclaredCapability(registry, platform, definition, route.capability);
  if (declaredCapability === null || declaredCapability === 'unsupported') {
    return stateResponse(response, makeUnsupported(context), context);
  }

  let driver;
  try {
    driver = runtime && typeof runtime.getDriver === 'function'
      ? runtime.getDriver(platform, route.capability)
      : null;
  } catch (error) {
    return stateResponse(response, makeFailure({ ...context, operation: 'resolve-driver' }, error), {
      ...context,
      operation: 'resolve-driver'
    });
  }

  const driverStatus = getStatus(driver);
  if (driverStatus) {
    return stateResponse(response, driver, context);
  }
  if (!driver) {
    return stateResponse(response, makeUnsupported(context), context);
  }

  const methodName = findOperation(driver, route.capability);
  if (!methodName) {
    return stateResponse(response, makeUnsupported({ ...context, operation: operation }), context);
  }

  const invocationContext = { ...context, operation: methodName };
  try {
    const value = await driver[methodName](...route.params(request));
    if (stateResponse(response, value, invocationContext)) return response;
    return response.status(200).json(value);
  } catch (error) {
    return stateResponse(response, makeFailure(invocationContext, error), invocationContext);
  }
}

function createPlatformRouteFactory({ registry, runtime } = {}) {
  return {
    mount(router) {
      for (const route of ROUTES) {
        router.get(route.path, (request, response) => invokeCapability({
          registry,
          runtime,
          request,
          response,
          route
        }));
      }
      return router;
    },
    invokeCapability
  };
}

module.exports = createPlatformRouteFactory;
module.exports.createPlatformRouteFactory = createPlatformRouteFactory;
module.exports._test = {
  addContext,
  makeFailure,
  makeUnsupported,
  stateResponse
};
