'use strict';

const { createPlatformContext } = require('../../../src/server/platform-context');

function createRegistry() {
  const manifest = {
    key: 'claude',
    capabilities: { projects: 'driver:projects' }
  };
  return {
    getCapability: (platform, capability) => manifest.key === platform ? manifest.capabilities[capability] : null,
    resolve: platform => manifest.key === platform ? manifest : null,
    resolvePaths: () => ({ home: '/tmp' })
  };
}

describe('platform context isolation', () => {
  test('creates independent runtimes with their own dependencies', () => {
    const created = [];
    const driverRegistry = {
      create: (id, context) => {
        created.push({ id, context });
        return { id, context };
      }
    };

    const first = createPlatformContext({
      registry: createRegistry(),
      driverRegistry,
      dependencies: { config: { projectsDir: '/first' } },
      sessionHistoryIndex: { listProjects: () => [] }
    });
    const second = createPlatformContext({
      registry: createRegistry(),
      driverRegistry,
      dependencies: { config: { projectsDir: '/second' } },
      sessionHistoryIndex: { listProjects: () => [] }
    });

    expect(first.runtime).not.toBe(second.runtime);
    expect(first.runtime.getDriver('claude', 'projects').context.config.projectsDir).toBe('/first');
    expect(second.runtime.getDriver('claude', 'projects').context.config.projectsDir).toBe('/second');
    expect(created).toHaveLength(2);
  });
});
