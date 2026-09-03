'use strict';

const { applyRequestCodec, applyResponseCodec, emptyPayload } = require('./platform-api-config');

const STATUS_CODES = Object.freeze({ ok: 200, invalid: 400, unsupported: 404, unavailable: 503, failed: 500 });

const DEFAULT_ROUTES = Object.freeze([
  { method: 'GET', path: '/projects', capability: 'projects', operation: 'listProjects', request: 'projects-list', response: 'projects-list' },
  { method: 'GET', path: '/sessions/:projectName', capability: 'sessions', operation: 'listSessions', request: 'sessions-list', response: 'sessions-list' },
  { method: 'GET', path: '/channels', capability: 'channels', operation: 'list', request: 'default', response: 'default' },
  { method: 'POST', path: '/channels', capability: 'channels', operation: 'create', request: 'default', response: 'default' },
  { method: 'PUT', path: '/channels/:channelId', capability: 'channels', operation: 'update', request: 'default', response: 'default' },
  { method: 'DELETE', path: '/channels/:channelId', capability: 'channels', operation: 'remove', request: 'default', response: 'default' },
  { method: 'GET', path: '/proxy/status', capability: 'proxy', operation: 'status', request: 'default', response: 'default' }
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).slice(0, 4096);
}

function addContext(value, { platform, capability, operation }) {
  const result = isObject(value) ? { ...value } : {};
  if (result.platform == null) result.platform = platform;
  if (result.capability == null) result.capability = capability;
  if (result.operation == null) result.operation = operation;
  if (result.code == null && result.status && result.status !== 'ok') result.code = result.status;
  return result;
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
function legacyArguments(route, request) {
  if (route.capability === 'projects' && route.operation === 'listProjects') return [{ force: request.query?.fresh === '1' }];
  if (route.capability === 'sessions' && route.operation === 'listSessions') {
    return [request.params.projectName, { force: request.query?.fresh === '1' }];
  }
  if (route.capability === 'channels') {
    if (route.method === 'POST') return [request.body || {}];
    if (route.method === 'PUT') return [request.params.channelId, request.body || {}];
    if (route.method === 'DELETE') return [request.params.channelId];
    return [{ force: request.query?.fresh === '1' }];
  }
  if (route.capability === 'proxy') return [{ force: request.query?.fresh === '1' }];
  return [];
}

function makeSuccess(context, data) {
  return { status: 'ok', platform: context.platform, capability: context.capability, operation: context.operation, data };
}

function resolvePlatform(registry, key) {
  return registry && typeof registry.resolve === 'function' ? registry.resolve(key) : null;
}

function getDeclaredCapability(registry, platform, definition, capability) {
  if (registry && typeof registry.getCapability === 'function') return registry.getCapability(platform, capability);
  return definition?.capabilities?.[capability];
}

function normalizeResult(value, context) {
  if (isObject(value) && typeof value.status === 'string') return addContext(value, context);
  return makeSuccess(context, value);
}

function sendDriverResult(response, value, route, context) {
  const result = normalizeResult(value, context);
  const statusCode = STATUS_CODES[result.status];
  if (!statusCode) return response.status(500).json({ error: makeFailure(context, new Error('Invalid Driver result status')) });
  if (result.status === 'ok') {
    const payload = applyResponseCodec(Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result, context.manifest, route, context);
    return response.status(200).json(payload);
  }
  return response.status(statusCode).json({ error: result });
}

function routePlatform(request, manifest) {
  return String(request.params.platform || manifest.key || '').trim().toLowerCase();
}

function sendLegacyResult(response, value, route, context) {
  if (isObject(value) && typeof value.status === 'string') {
    return sendDriverResult(response, value, route, context);
  }
  return response.status(200).json(value);
}

async function invokeRoute({ registry, runtime, config, request, response, manifest: suppliedManifest, route }) {
  const platform = routePlatform(request, suppliedManifest || {});
  const manifest = suppliedManifest || resolvePlatform(registry, platform);
  const operation = route.operation;
  const context = { platform, manifest, config, capability: route.capability, operation };

  if (!manifest) {
    return response.status(404).json({ error: { status: 'invalid', code: 'not_found', platform, capability: route.capability, operation, error: `Unknown platform: ${platform}` } });
  }

  const legacyRoute = !manifest.api?.routes;
  const declaredCapability = getDeclaredCapability(registry, platform, manifest, route.capability);
  const absentCapability = declaredCapability === null || declaredCapability === undefined || declaredCapability === 'unsupported';
  if (absentCapability) {
    return !legacyRoute && route.method === 'GET'
      ? sendDriverResult(response, makeSuccess(context, emptyPayload(route)), route, context)
      : sendDriverResult(response, makeUnsupported(context), route, context);
  }

  let driver;
  const isDescriptorRoute = Boolean(manifest.api?.routes);
  try {
    driver = runtime?.getDriver?.(
      platform,
      route.capability,
      { config, manifest, route, apiRoute: isDescriptorRoute }
    );
  } catch (error) {
    return sendDriverResult(response, makeFailure(context, error), route, context);
  }
  if (!driver || typeof driver[operation] !== 'function') {
    return !legacyRoute && route.method === 'GET'
      ? sendDriverResult(response, makeSuccess(context, emptyPayload(route)), route, context)
      : sendDriverResult(response, makeUnsupported(context), route, context);
  }

  try {
    const invocation = isDescriptorRoute
      ? applyRequestCodec(request, manifest, route, config)
      : legacyArguments(route, request);
    const value = isDescriptorRoute
      ? await driver[operation](invocation)
      : await driver[operation](...invocation);
    return isDescriptorRoute
      ? sendDriverResult(response, value, route, { ...context, ...invocation })
      : sendLegacyResult(response, value, route, context);
  } catch (error) {
    return sendDriverResult(response, makeFailure(context, error), route, context);
  }
}

function normalizeRoute(route) {
  return { method: 'GET', ...route, method: String(route.method || 'GET').toUpperCase() };
}

function joinPath(prefix, routePath) {
  const left = String(prefix || '').replace(/\/$/, '');
  const right = String(routePath || '/');
  return `${left}${right.startsWith('/') ? right : `/${right}`}` || '/';
}

function createPlatformRouteFactory({ registry, runtime, config } = {}) {
  function routesFor(manifest) {
    return (manifest?.api?.routes || DEFAULT_ROUTES).map(normalizeRoute);
  }

  function createHandler(manifest, route) {
    return (request, response) => invokeRoute({ registry, runtime, config, request, response, manifest, route });
  }

  return {
    routesFor,
    createHandler,
    mount(router, { manifest, basePath = '/:platform', aliases = false } = {}) {
      const definitions = manifest
        ? [manifest]
        : (registry?.list?.({ enabledOnly: true }) || []);
      const manifests = definitions.length > 0 || !basePath.includes(':platform')
        ? definitions
        : [null];
      for (const definition of manifests) {
        for (const route of routesFor(definition)) {
          if (aliases && !definition?.api?.rootAlias) continue;
          const firstSegment = route.path.split('/').filter(Boolean)[0];
          if (aliases && !definition.api.rootAliasPaths?.includes(firstSegment)) continue;
          const path = joinPath(basePath, route.path);
          router[route.method.toLowerCase()](path, createHandler(definition, route));
        }
      }
      return router;
    },
    invokeRoute
  };
}

module.exports = createPlatformRouteFactory;
module.exports.createPlatformRouteFactory = createPlatformRouteFactory;
module.exports._test = { addContext, makeFailure, makeUnsupported, sendDriverResult, invokeRoute, normalizeResult };
