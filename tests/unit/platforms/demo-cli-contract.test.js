'use strict';

const { createPlatformRegistry } = require('../../../src/platforms/registry');
const { createPlatformRuntime } = require('../../../src/platforms/runtime');
const { getDriverRegistry } = require('../../../src/platforms/driver-registry');

describe('demo-cli configuration-only contract', () => {
  test('discovers generic capabilities without server platform branches', () => {
    const registry = createPlatformRegistry({
      builtIns: [],
      userFile: {
        platforms: [{
          key: 'demo-cli',
          label: 'Demo CLI',
          command: 'demo',
          iconToken: 'terminal',
          paths: { home: '/tmp/demo-cli', sessions: '/tmp/demo-cli/sessions', baseUrl: 'https://demo.invalid/v1' },
          resourceMappings: { skills: '{home}/skills' },
          sessionMapping: { sessionId: 'id', projectName: 'project', messages: 'messages' },
          capabilities: {
            sessions: 'generic-jsonl',
            resourceSync: 'generic-filesystem',
            channels: 'generic-openai-compatible',
            proxy: 'unsupported'
          }
        }]
      }
    });
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });

    expect(registry.resolve('demo-cli')).toEqual(expect.objectContaining({ key: 'demo-cli' }));
    expect(typeof runtime.getDriver('demo-cli', 'sessions').inventory).toBe('function');
    expect(typeof runtime.getDriver('demo-cli', 'resourceSync').sync).toBe('function');
    expect(typeof runtime.getDriver('demo-cli', 'channels').request).toBe('function');
    expect(runtime.getDriver('demo-cli', 'proxy')).toEqual({
      status: 'unsupported', platform: 'demo-cli', capability: 'proxy'
    });
  });
});
