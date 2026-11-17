'use strict';

const crypto = require('crypto');
const { applyRequestCodec, applyResponseCodec } = require('./platform-api-config');

const STATUS_CODES = Object.freeze({ ok: 200, invalid: 400, conflict: 409, unprocessable: 422, unsupported: 404, unavailable: 503, failed: 500 });
const CHANNEL_CREATE_DEDUPE_TTL_MS = 120 * 1000;
const CHANNEL_CREATE_DEDUPE_LIMIT = 128;
const channelCreateResults = new Map();
const channelCreateInflight = new Map();
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function channelCreateDedupeKey(platform, invocation) {
  if (!invocation?.body || typeof invocation.body !== 'object') return null;
  const digest = crypto.createHash('sha1')
    .update(stableStringify(invocation.body))
    .digest('hex');
  return `${platform}:${invocation.remoteAddress || ''}:${digest}`;
}

function clearChannelCreateResults(platform) {
  const prefix = `${platform}:`;
  for (const key of channelCreateResults.keys()) {
    if (key.startsWith(prefix)) channelCreateResults.delete(key);
  }
}

async function invokeDriverOperation({ driver, operation, invocation, platform, route }) {
  const isChannelCreate = route.capability === 'channels' && operation === 'create';
  const dedupeKey = isChannelCreate
    ? channelCreateDedupeKey(platform, invocation)
    : null;
  if (!dedupeKey) {
    const value = await driver[operation](invocation);
    // A successful create/update/delete makes previously cached create results
    // stale (delete then re-create the same channel within the window must
    // execute). Read routes must not clear the retry window.
    const isChannelMutation = route.capability === 'channels'
      && !READ_ONLY_METHODS.has(String(route.method || 'GET').toUpperCase());
    if (isChannelMutation && value && value.status === 'ok') {
      clearChannelCreateResults(platform);
    }
    return value;
  }

  const cached = channelCreateResults.get(dedupeKey);
  if (cached) {
    if (Date.now() < cached.expiresAt) return cached.value;
    channelCreateResults.delete(dedupeKey);
  }
  const inflight = channelCreateInflight.get(dedupeKey);
  if (inflight) return inflight;

  const task = Promise.resolve().then(() => driver[operation](invocation));
  channelCreateInflight.set(dedupeKey, task);
  try {
    const value = await task;
    if (value && value.status === 'ok') {
      channelCreateResults.set(dedupeKey, {
        value,
        expiresAt: Date.now() + CHANNEL_CREATE_DEDUPE_TTL_MS
      });
      while (channelCreateResults.size > CHANNEL_CREATE_DEDUPE_LIMIT) {
        channelCreateResults.delete(channelCreateResults.keys().next().value);
      }
    }
    return value;
  } finally {
    if (channelCreateInflight.get(dedupeKey) === task) {
      channelCreateInflight.delete(dedupeKey);
    }
  }
}

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
  const status = cause.statusCode === 409 ? 'conflict'
    : cause.statusCode === 422 ? 'unprocessable'
      : cause.statusCode === 400 ? 'invalid'
        : cause.statusCode === 503 ? 'unavailable' : 'failed';
  const result = {
    status,
    code: cause.code || status,
    platform: context.platform,
    capability: context.capability,
    operation: context.operation,
    error: safeText(cause.message, 'Platform route failed')
  };
  if (cause.conflictingChannelId) result.conflictingChannelId = cause.conflictingChannelId;
  if (cause.conflictingChannelName) result.conflictingChannelName = cause.conflictingChannelName;
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
  const listOptions = () => {
    const options = { force: request.query?.fresh === '1' };
    if (request.query?.page != null) options.page = request.query.page;
    if (request.query?.limit != null) options.limit = request.query.limit;
    if (request.query?.q || request.query?.search) options.q = request.query.q || request.query.search;
    return options;
  };
  if (route.capability === 'projects' && route.operation === 'listProjects') return [listOptions()];
  if (route.capability === 'sessions' && route.operation === 'listSessions') {
    return [request.params.projectName, listOptions()];
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
  const manifest = suppliedManifest?.key === platform
    ? suppliedManifest
    : resolvePlatform(registry, platform);
  const operation = route.operation;
  const context = { platform, manifest, config, capability: route.capability, operation };

  if (!manifest) {
    return response.status(404).json({ error: { status: 'invalid', code: 'not_found', platform, capability: route.capability, operation, error: `Unknown platform: ${platform}` } });
  }

  const legacyRoute = !manifest.api?.routes;
  const declaredCapability = getDeclaredCapability(registry, platform, manifest, route.capability);
  const absentCapability = declaredCapability === null || declaredCapability === undefined || declaredCapability === 'unsupported';
  if (absentCapability) {
    return sendDriverResult(response, makeUnsupported(context), route, context);
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
    return sendDriverResult(response, makeUnsupported(context), route, context);
  }

  try {
    const invocation = isDescriptorRoute
      ? applyRequestCodec(request, manifest, route, config)
      : legacyArguments(route, request);
    const value = isDescriptorRoute
      ? await invokeDriverOperation({ driver, operation, invocation, platform, route })
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
