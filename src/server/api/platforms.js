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
  'promptLabel',
  'resourceTypes'
]);

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

function toPublicDefinition(definition) {
  if (!definition || typeof definition !== 'object') return null;
  const result = {};
  for (const field of PUBLIC_FIELDS) {
    if (field === 'resourceTypes') {
      const resourceTypes = publicResourceTypes(definition.resourceTypes);
      if (resourceTypes) result.resourceTypes = resourceTypes;
      continue;
    }
    if (field === 'promptLabel') {
      if (typeof definition.promptLabel === 'string' && definition.promptLabel.trim()) {
        result.promptLabel = definition.promptLabel;
      }
      continue;
    }
    if (definition[field] !== undefined) result[field] = definition[field];
  }
  result.capabilities = publicCapabilities(definition.capabilities);
  return result.key ? result : null;
}

function defaultDependencies() {
  const { getPlatformRegistry, getPlatformRuntime } = require('../../platforms/runtime');
  return {
    registry: getPlatformRegistry(),
    runtime: getPlatformRuntime()
  };
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
