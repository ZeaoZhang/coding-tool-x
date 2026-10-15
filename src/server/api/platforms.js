'use strict';

const express = require('express');
const createPlatformRouteFactory = require('./platform-route-factory');

const PUBLIC_FIELDS = Object.freeze([
  'key',
  'label',
  'title',
  'command',
  'iconToken',
  'color',
  'defaultVisible',
  'defaultEnabled',
  'sortOrder',
  'portKey',
  'defaultPort',
  'portLabel',
  'apiPrefix',
  'apiRoutes',
  'modelCatalogKey',
  'logLayout',
  'promptLabel',
  'resourceTypes',
  'resourceActions'
]);

const DEFAULT_API_ROUTES = Object.freeze([
  { method: 'GET', path: '/projects', capability: 'projects', operation: 'listProjects' },
  { method: 'GET', path: '/sessions/:projectName', capability: 'sessions', operation: 'listSessions' },
  { method: 'GET', path: '/channels', capability: 'channels', operation: 'list' },
  { method: 'POST', path: '/channels', capability: 'channels', operation: 'create' },
  { method: 'PUT', path: '/channels/:channelId', capability: 'channels', operation: 'update' },
  { method: 'DELETE', path: '/channels/:channelId', capability: 'channels', operation: 'remove' },
  { method: 'GET', path: '/proxy/status', capability: 'proxy', operation: 'status' }
]);

function publicApiRoutes(api) {
  const routes = Array.isArray(api?.routes) ? api.routes : DEFAULT_API_ROUTES;
  return routes
    .filter(route => route && typeof route === 'object' && !Array.isArray(route))
    .filter(route => typeof route.path === 'string' && route.path.startsWith('/')
      && typeof route.capability === 'string' && typeof route.operation === 'string')
    .map(route => ({
      method: String(route.method || 'GET').toUpperCase(),
      path: route.path,
      capability: route.capability,
      operation: route.operation
    }));
}

function publicCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return {};
  }
  return Object.fromEntries(Object.entries(capabilities).map(([key, value]) => [
    key,
    typeof value === 'boolean' ? value : value !== 'unsupported' && value != null
  ]));
}

function publicResourceTypes(resourceTypes) {
  if (!resourceTypes || typeof resourceTypes !== 'object' || Array.isArray(resourceTypes)) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(resourceTypes).filter(([, value]) => typeof value === 'boolean')
  );
}

function publicResourceActions(resourceActions) {
  if (!resourceActions || typeof resourceActions !== 'object' || Array.isArray(resourceActions)) {
    return null;
  }
  return Object.fromEntries(Object.entries(resourceActions).map(([resourceType, actions]) => [
    resourceType,
    actions && typeof actions === 'object' && !Array.isArray(actions)
      ? Object.fromEntries(Object.entries(actions).filter(([, value]) => typeof value === 'boolean'))
      : {}
  ]));
}

function toPublicDefinition(definition) {
  if (!definition || typeof definition !== 'object') return null;
  const result = {};
  for (const field of PUBLIC_FIELDS) {
    if (field === 'resourceTypes') {
      const resourceTypes = publicResourceTypes(definition.resourceTypes);
      if (resourceTypes) result.resourceTypes = resourceTypes;
      continue;
    }
    if (field === 'resourceActions') {
      const resourceActions = publicResourceActions(definition.resourceActions);
      if (resourceActions) result.resourceActions = resourceActions;
      continue;
    }
    if (field === 'apiRoutes') {
      result.apiRoutes = publicApiRoutes(definition.api);
      continue;
    }
    if (field === 'apiPrefix') {
      const apiPrefix = definition.apiPrefix ?? definition.api?.prefix;
      if (apiPrefix !== undefined) result.apiPrefix = apiPrefix || null;
      continue;
    }
    if (field === 'modelCatalogKey') {
      result.modelCatalogKey = definition.modelCatalogKey
        || definition.modelConfig?.catalogKey
        || definition.key;
      continue;
    }
    if (definition[field] !== undefined) result[field] = definition[field];
  }
  result.capabilities = publicCapabilities(definition.capabilities);
  return result.key ? result : null;
}

function defaultDependencies() {
  return require('../platform-context').getPlatformContext();
}

function createPlatformRouter(options = {}) {
  let registry = options.registry;
  let runtime = options.runtime;
  if (!registry || !runtime) {
    const defaults = defaultDependencies();
    registry = registry || defaults.registry;
    runtime = runtime || defaults.runtime;
  }
  const router = express.Router();

  router.get('/', (request, response) => {
    try {
      const definitions = typeof registry.list === 'function' ? registry.list() : [];
      const platforms = definitions.map(toPublicDefinition).filter(Boolean);
      return response.json({ platforms });
    } catch (error) {
      return response.status(500).json({
        error: {
          status: 'failed',
          code: 'failed',
          operation: 'list-platforms',
          error: error && error.message ? error.message : String(error)
        }
      });
    }
  });

  createPlatformRouteFactory({ registry, runtime }).mount(router);
  return router;
}

module.exports = createPlatformRouter;
module.exports.createPlatformRouter = createPlatformRouter;
module.exports._test = {
  publicCapabilities,
  toPublicDefinition
};
