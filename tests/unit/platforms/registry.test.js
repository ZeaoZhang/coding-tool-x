'use strict';

const { createPlatformRegistry } = require('../../../src/platforms/registry');

test('resolves built-ins and rejects a user override', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
    userFile: {
      platforms: [
        { key: 'claude', label: 'Fake Claude', command: 'fake', capabilities: {} },
        { key: 'demo-cli', label: 'Demo', command: 'demo', capabilities: { sessions: 'generic-jsonl' } }
      ]
    }
  });

  expect(registry.resolve('claude').label).toBe('Claude');
  expect(registry.resolve('demo-cli').label).toBe('Demo');
  expect(registry.diagnostics()).toEqual([]);
});

test('public definitions expose support flags without internal driver configuration', () => {
  const registry = createPlatformRegistry({
    builtIns: [{
      key: 'demo-cli',
      label: 'Demo',
      title: 'Demo CLI',
      command: 'demo',
      iconToken: 'terminal',
      color: '#123456',
      defaultVisible: true,
      apiBasePath: '/api/demo',
      logFile: 'demo.log',
      portKey: 'demoProxy',
      defaultPort: 18080,
      pathResolverId: 'declarative',
      paths: { home: '/tmp/demo' },
      capabilities: {
        sessions: 'generic-jsonl',
        proxy: 'unsupported',
        resourceSync: 'generic-filesystem'
      }
    }],
    userFile: { platforms: [] }
  });

  expect(registry.getPublicDefinition('demo-cli')).toEqual({
    key: 'demo-cli',
    label: 'Demo',
    title: 'Demo CLI',
    command: 'demo',
    iconToken: 'terminal',
    color: '#123456',
    defaultVisible: true,
    capabilities: {
      sessions: true,
      proxy: false,
      resourceSync: true
    }
  });
});
