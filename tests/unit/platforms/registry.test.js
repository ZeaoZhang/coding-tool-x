'use strict';

const Module = require('module');
const REGISTRY_PATH = require.resolve('../../../src/platforms/registry');

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

test('explicit registry inputs do not load PATHS configuration', () => {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === '../config/paths'
    ? (() => { throw new Error('config paths loaded'); })()
    : originalLoad(request, parent, isMain);
  delete require.cache[REGISTRY_PATH];
  try {
    const { createPlatformRegistry: createWithoutPaths } = require('../../../src/platforms/registry');
    const registry = createWithoutPaths({
      builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
      userFile: { platforms: [] }
    });

    expect(registry.resolve('claude').label).toBe('Claude');
  } finally {
    delete require.cache[REGISTRY_PATH];
    Module._load = originalLoad;
  }
});

test('duplicate user platform keys keep the first entry and record diagnostics', () => {
  const registry = createPlatformRegistry({
    builtIns: [],
    userFile: {
      platforms: [
        { key: 'demo-cli', label: 'Demo One', command: 'demo-one', capabilities: {} },
        { key: 'demo-cli', label: 'Demo Two', command: 'demo-two', capabilities: {} }
      ]
    }
  });

  expect(registry.resolve('demo-cli').label).toBe('Demo One');
  expect(registry.diagnostics()).toEqual([
    { key: 'demo-cli', source: 'userFile', message: 'duplicate platform key ignored' }
  ]);
});

test('resolve and list return cloned manifests that cannot mutate registry state', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: { sessions: 'legacy:claude' } }],
    userFile: { platforms: [] }
  });

  const resolved = registry.resolve('claude');
  resolved.label = 'Mutated';
  resolved.capabilities.sessions = 'unsupported';
  registry.list()[0].label = 'Mutated Again';

  expect(registry.resolve('claude')).toEqual({
    key: 'claude',
    label: 'Claude',
    command: 'claude',
    capabilities: { sessions: 'legacy:claude' }
  });
});
