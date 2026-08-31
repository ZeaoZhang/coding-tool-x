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

test('legacy customCliPlatforms do not enter the registry', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
    legacyUiConfig: {
      customCliPlatforms: [{ key: 'demo-cli', name: 'Demo', command: 'demo', enabled: true }]
    },
    userFile: { platforms: [] }
  });

  expect(registry.resolve('demo-cli')).toBeNull();
  expect(registry.list().map(platform => platform.key)).toEqual(['claude']);
});

test('invalid user driver IDs are rejected with an explicit diagnostic reason', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
    userFile: {
      platforms: [{
        key: 'demo-cli',
        label: 'Demo',
        command: 'demo',
        capabilities: { proxy: 'user-code' }
      }]
    }
  });

  expect(registry.resolve('demo-cli')).toBeNull();
  expect(registry.diagnostics()[0]).toEqual(expect.objectContaining({
    key: 'demo-cli',
    source: 'userFile',
    reason: expect.stringMatching(/invalid|driver/i)
  }));
});

test('user manifests cannot select reserved legacy capability drivers', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
    userFile: {
      platforms: [
        {
          key: 'demo-cli',
          label: 'Demo',
          command: 'demo',
          capabilities: { sessions: 'legacy:claude' }
        },
        {
          key: 'generic-cli',
          label: 'Generic',
          command: 'generic',
          capabilities: { sessions: 'generic-jsonl' }
        }
      ]
    }
  });

  expect(registry.resolve('demo-cli')).toBeNull();
  expect(registry.resolve('generic-cli').label).toBe('Generic');
  expect(registry.diagnostics()).toEqual([
    expect.objectContaining({
      key: 'demo-cli',
      source: 'userFile',
      reason: expect.stringMatching(/legacy|reserved/i)
    })
  ]);
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
      promptLabel: 'Demo prompt',
      resourceTypes: { skills: true, commands: false },
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
    promptLabel: 'Demo prompt',
    resourceTypes: { skills: true, commands: false },
    capabilities: {
      sessions: true,
      proxy: false,
      resourceSync: true
    }
  });
});

test('built-in manifests expose MCP and valid prompt capabilities', () => {
  const registry = createPlatformRegistry({ userFile: { platforms: [] } });

  for (const platform of ['claude', 'codex', 'gemini', 'opencode']) {
    expect(registry.getCapability(platform, 'mcp')).toBe(`legacy:${platform}`);
    expect(registry.getCapability(platform, 'prompts')).toBe(`legacy:${platform}`);
    expect(registry.getPublicDefinition(platform).capabilities).toEqual(expect.objectContaining({
      mcp: true,
      prompts: true
    }));
  }

  expect(registry.getCapability('omp', 'mcp')).toBe('legacy:omp');
  expect(registry.getCapability('omp', 'prompts')).toBeNull();
  expect(registry.getPublicDefinition('omp').capabilities).toEqual(expect.objectContaining({
    mcp: true
  }));
  expect(registry.getPublicDefinition('omp').capabilities.prompts).toBeUndefined();
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

test('default registry file lookup does not load PATHS configuration when file is missing', () => {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === '../config/paths'
    ? (() => { throw new Error('config paths loaded'); })()
    : originalLoad(request, parent, isMain);
  delete require.cache[REGISTRY_PATH];
  try {
    const { createPlatformRegistry: createWithoutPaths } = require('../../../src/platforms/registry');
    const checkedPaths = [];
    const registry = createWithoutPaths({
      builtIns: [],
      fsImpl: {
        existsSync: path => {
          checkedPaths.push(path);
          return false;
        }
      }
    });

    expect(registry.list()).toEqual([]);
    expect(registry.diagnostics()).toEqual([]);
    expect(checkedPaths).toEqual([expect.stringContaining('.cc-tool/config/platforms.json')]);
  } finally {
    delete require.cache[REGISTRY_PATH];
    Module._load = originalLoad;
  }
});

test('platformsFile option controls user manifest file lookup', () => {
  const fsImpl = {
    existsSync: vi.fn(path => path === '/tmp/platforms.json'),
    readFileSync: vi.fn(() => JSON.stringify({
      platforms: [{ key: 'demo-cli', label: 'Demo', command: 'demo', capabilities: {} }]
    }))
  };

  const registry = createPlatformRegistry({ builtIns: [], fsImpl, platformsFile: '/tmp/platforms.json' });

  expect(registry.resolve('demo-cli').label).toBe('Demo');
  expect(fsImpl.existsSync).toHaveBeenCalledWith('/tmp/platforms.json');
  expect(fsImpl.readFileSync).toHaveBeenCalledWith('/tmp/platforms.json', 'utf8');
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

test('public definitions expose safe project resource metadata', () => {
  const registry = createPlatformRegistry({
    builtIns: [{
      key: 'codex',
      label: 'Codex',
      command: 'codex',
      paths: { home: '/tmp/codex' },
      projectResources: {
        instruction: { path: 'AGENTS.md' },
        skills: { canonicalRoot: '.agents/skills', readRoots: ['.agents/skills', '.codex/skills'] },
        mcp: { path: '.codex/config.toml', format: 'codex-toml' }
      },
      capabilities: {}
    }],
    userFile: { platforms: [] }
  });

  expect(registry.getPublicDefinition('codex')).toEqual(expect.objectContaining({
    projectResources: {
      instruction: { path: 'AGENTS.md' },
      skills: {
        canonicalRoot: '.agents/skills',
        readRoots: ['.agents/skills', '.codex/skills']
      },
      mcp: { path: '.codex/config.toml', format: 'codex-toml' }
    }
  }));
  expect(JSON.stringify(registry.getPublicDefinition('codex'))).not.toContain('/tmp/codex');
});
