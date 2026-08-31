'use strict';

const { createUnsupportedDriver } = require('./drivers/unsupported');
const { createGenericJsonlDriver } = require('./drivers/generic-jsonl');
const { createGenericFilesystemDriver } = require('./drivers/generic-filesystem');
const { createGenericOpenAICompatibleDriver } = require('./drivers/generic-openai-compatible');
const { createGenericMcpDriver } = require('./drivers/generic-mcp');
const { createGenericPromptDriver } = require('./drivers/generic-prompt');
const { registerLegacyDrivers } = require('./drivers/legacy');

const DRIVER_ID_PATTERN = /^[a-z0-9:_-]+$/;

function createDriverRegistry({ drivers = {} } = {}) {
  const factories = new Map(Object.entries(drivers));

  return {
    register(id, factory) {
      const driverId = String(id || '');
      if (!DRIVER_ID_PATTERN.test(driverId) || typeof factory !== 'function') {
        throw new Error(`Invalid capability driver: ${id}`);
      }
      factories.set(driverId, factory);
    },
    has(id) {
      return factories.has(id);
    },
    create(id, context = {}) {
      const factory = factories.get(id);
      if (!factory) throw new Error(`Unknown capability driver: ${id}`);
      return factory(context);
    },
    ids() {
      return [...factories.keys()];
    }
  };
}

let defaultRegistry;

function getDriverRegistry() {
  if (!defaultRegistry) {
    defaultRegistry = createDriverRegistry({
      drivers: {
        unsupported: createUnsupportedDriver,
        'generic-jsonl': createGenericJsonlDriver,
        'generic-filesystem': createGenericFilesystemDriver,
        'generic-openai-compatible': createGenericOpenAICompatibleDriver,
        'generic-mcp': createGenericMcpDriver,
        'generic-prompt': createGenericPromptDriver
      }
    });
    registerLegacyDrivers(defaultRegistry);
  }
  return defaultRegistry;
}

module.exports = { createDriverRegistry, getDriverRegistry };
