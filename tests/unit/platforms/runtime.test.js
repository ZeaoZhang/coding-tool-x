'use strict';

const Module = require('module');
const fs = require('fs');
const path = require('path');
const RUNTIME_PATH = require.resolve('../../../src/platforms/runtime');

const { createPlatformRuntime } = require('../../../src/platforms/runtime');
const { createPlatformRegistry } = require('../../../src/platforms/registry');
const { getDriverRegistry } = require('../../../src/platforms/driver-registry');

test('creates injected capability drivers with resolved manifest and flat dependencies', () => {
  const driver = { list: vi.fn(() => ['session-1']) };
  const driverRegistry = { create: vi.fn(() => driver) };
  const manifest = { key: 'demo-cli', paths: { home: '/tmp/demo', sessions: '{home}/sessions', baseUrl: 'https://api.example.test/v1' } };
  const registry = {
    getCapability: vi.fn(() => 'generic-jsonl'),
    resolve: vi.fn(() => manifest),
    resolvePaths: vi.fn(() => ({ home: '/tmp/demo', sessions: '/tmp/demo/sessions', baseUrl: 'https://api.example.test/v1' }))
  };
  const dependencies = { fsImpl: { marker: true }, fetchImpl: vi.fn(), clock: () => 123 };
  const runtime = createPlatformRuntime({ registry, driverRegistry, dependencies });

  expect(runtime.getDriver('demo-cli', 'sessions', { project: '/tmp/project' })).toBe(driver);
  expect(registry.resolvePaths).toHaveBeenCalledWith('demo-cli', {});
  expect(driverRegistry.create).toHaveBeenCalledWith('generic-jsonl', expect.objectContaining({
    platform: 'demo-cli',
    capability: 'sessions',
    manifest: expect.objectContaining({ key: 'demo-cli', paths: expect.objectContaining({ home: '/tmp/demo', sessions: '/tmp/demo/sessions' }) }),
    context: { project: '/tmp/project' },
    dependencies
  }));
  expect(driverRegistry.create.mock.calls[0][1]).toEqual(expect.objectContaining(dependencies));
  expect(driverRegistry.create.mock.calls[0][1].fsImpl).toBe(dependencies.fsImpl);
  expect(driverRegistry.create.mock.calls[0][1].fetchImpl).toBe(dependencies.fetchImpl);
  expect(runtime.invoke('demo-cli', 'sessions', 'list')).toEqual(['session-1']);
});

test('runtime passes legacy manifests through without path resolution', () => {
  const driver = { list: vi.fn(() => ['legacy-session']) };
  const driverRegistry = { create: vi.fn(() => driver) };
  const manifest = { key: 'claude', paths: { sessions: '{home}/projects' }, capabilities: { sessions: 'legacy:claude' } };
  const registry = {
    getCapability: vi.fn(() => 'legacy:claude'),
    resolve: vi.fn(() => manifest),
    resolvePaths: vi.fn(() => { throw new Error('path resolver should not run for legacy drivers'); })
  };
  const runtime = createPlatformRuntime({ registry, driverRegistry });

  expect(runtime.getDriver('claude', 'sessions')).toBe(driver);
  expect(registry.resolvePaths).not.toHaveBeenCalled();
  expect(driverRegistry.create).toHaveBeenCalledWith('legacy:claude', expect.objectContaining({
    platform: 'claude',
    capability: 'sessions',
    manifest
  }));
  expect(runtime.invoke('claude', 'sessions', 'list')).toEqual(['legacy-session']);
});

test('runtime passes resolved paths and flat dependencies into a generic driver', async () => {
  const fsImpl = {
    readdir: async () => ['session-1.jsonl'],
    stat: async () => ({ size: 20, mtimeMs: 10 }),
    readFile: async () => '{"role":"user","content":"hello"}\n'
  };
  const manifest = { key: 'demo-cli', paths: { home: '/tmp/demo', sessions: '{home}/sessions' } };
  const registry = {
    getCapability: () => 'generic-jsonl',
    resolve: () => manifest,
    resolvePaths: () => ({ home: '/tmp/demo', sessions: '/tmp/demo/sessions' })
  };
  const driverRegistry = require('../../../src/platforms/driver-registry').createDriverRegistry({
    drivers: { 'generic-jsonl': require('../../../src/platforms/drivers/generic-jsonl').createGenericJsonlDriver }
  });
  const runtime = createPlatformRuntime({ registry, driverRegistry, dependencies: { fsImpl } });

  await expect(runtime.getDriver('demo-cli', 'sessions').inventory()).resolves.toEqual([
    expect.objectContaining({ filePath: '/tmp/demo/sessions/session-1.jsonl' })
  ]);
});

test('runtime passes resolved resource mappings and flat fs dependency into a generic filesystem driver', async () => {
  const calls = [];
  const fsImpl = {
    readdir: async root => { calls.push(['readdir', root]); return ['tool.md']; },
    stat: async filePath => ({ isDirectory: () => false, isFile: () => true, size: 7, mtimeMs: 11 }),
    mkdir: async target => calls.push(['mkdir', target]),
    copyFile: async (source, target) => calls.push(['copyFile', source, target])
  };
  const manifest = {
    key: 'demo-cli',
    paths: { home: '/tmp/demo' },
    resourceMappings: { commands: '{home}/commands' }
  };
  const registry = {
    getCapability: () => 'generic-filesystem',
    resolve: () => manifest,
    resolvePaths: () => ({ home: '/tmp/demo' })
  };
  const driverRegistry = require('../../../src/platforms/driver-registry').createDriverRegistry({
    drivers: { 'generic-filesystem': require('../../../src/platforms/drivers/generic-filesystem').createGenericFilesystemDriver }
  });
  const runtime = createPlatformRuntime({ registry, driverRegistry, dependencies: { fsImpl } });
  const driver = runtime.getDriver('demo-cli', 'resourceSync');

  await expect(driver.list('commands')).resolves.toEqual([
    expect.objectContaining({ target: '/tmp/demo/commands/tool.md' })
  ]);
  await expect(driver.sync('commands', 'tools/run.md', '/tmp/source.md')).resolves.toEqual({
    status: 'ok', target: '/tmp/demo/commands/tools/run.md'
  });
  expect(calls).toEqual([
    ['readdir', '/tmp/demo/commands'],
    ['mkdir', '/tmp/demo/commands/tools'],
    ['copyFile', '/tmp/source.md', '/tmp/demo/commands/tools/run.md']
  ]);
});

test('runtime rejects relative resource mappings that escape the resolved home', () => {
  const driverRegistry = { create: vi.fn() };
  const manifest = {
    key: 'demo-cli',
    paths: { home: '/tmp/demo' },
    resourceMappings: { commands: '../outside' }
  };
  const registry = {
    getCapability: () => 'generic-filesystem',
    resolve: () => manifest,
    resolvePaths: () => ({ home: '/tmp/demo' })
  };
  const runtime = createPlatformRuntime({ registry, driverRegistry });

  expect(() => runtime.getDriver('demo-cli', 'resourceSync')).toThrow(/resource mapping commands escapes home/);
  expect(driverRegistry.create).not.toHaveBeenCalled();
});

test('runtime keeps URL resource mappings out of filesystem containment checks', () => {
  const driver = { ok: true };
  const driverRegistry = { create: vi.fn(() => driver) };
  const manifest = {
    key: 'demo-cli',
    paths: { home: '/tmp/demo' },
    resourceMappings: { remote: '$REMOTE_ROOT' }
  };
  const registry = {
    getCapability: () => 'generic-openai-compatible',
    resolve: () => manifest,
    resolvePaths: () => ({ home: '/tmp/demo' })
  };
  const runtime = createPlatformRuntime({
    registry,
    driverRegistry,
    dependencies: { pathResolverOptions: { env: { REMOTE_ROOT: 'https://api.example.test/resources' } } }
  });

  expect(runtime.getDriver('demo-cli', 'channels')).toBe(driver);
  expect(driverRegistry.create.mock.calls[0][1].manifest.resourceMappings.remote).toBe('https://api.example.test/resources');
});

test('runtime expands tilde resource mappings consistently with manifest paths', () => {
  const driver = { ok: true };
  const driverRegistry = { create: vi.fn(() => driver) };
  const manifest = {
    key: 'demo-cli',
    paths: { home: '~/.demo' },
    resourceMappings: { commands: '~/.demo/commands' }
  };
  const registry = {
    getCapability: () => 'generic-filesystem',
    resolve: () => manifest,
    resolvePaths: () => ({ home: '/Users/demo/.demo' })
  };
  const runtime = createPlatformRuntime({ registry, driverRegistry, dependencies: { pathResolverOptions: { homeDir: '/Users/demo' } } });

  expect(runtime.getDriver('demo-cli', 'resourceSync')).toBe(driver);
  expect(driverRegistry.create.mock.calls[0][1].manifest.resourceMappings.commands).toBe('/Users/demo/.demo/commands');
});

test('runtime rejects tilde resource mappings that escape resolved home', () => {
  const driverRegistry = { create: vi.fn() };
  const manifest = {
    key: 'demo-cli',
    paths: { home: '~/.demo' },
    resourceMappings: { commands: '~/../../outside' }
  };
  const registry = {
    getCapability: () => 'generic-filesystem',
    resolve: () => manifest,
    resolvePaths: () => ({ home: '/Users/demo/.demo' })
  };
  const runtime = createPlatformRuntime({ registry, driverRegistry, dependencies: { pathResolverOptions: { homeDir: '/Users/demo' } } });

  expect(() => runtime.getDriver('demo-cli', 'resourceSync')).toThrow(/resource mapping commands escapes home/);
  expect(driverRegistry.create).not.toHaveBeenCalled();
});

test('runtime preserves environment-resolved OpenAI base URLs for generic channels', () => {
  const { resolveManifestPaths } = require('../../../src/platforms/path-resolver');
  const fetchImpl = vi.fn();
  const manifest = { key: 'demo-cli', paths: { home: '/tmp/demo', baseUrl: '$API_BASE' } };
  const registry = {
    getCapability: () => 'generic-openai-compatible',
    resolve: () => manifest,
    resolvePaths: (_platform, options) => resolveManifestPaths(manifest, options)
  };
  const driverRegistry = require('../../../src/platforms/driver-registry').createDriverRegistry({
    drivers: { 'generic-openai-compatible': require('../../../src/platforms/drivers/generic-openai-compatible').createGenericOpenAICompatibleDriver }
  });
  const runtime = createPlatformRuntime({
    registry,
    driverRegistry,
    dependencies: { fetchImpl, pathResolverOptions: { env: { API_BASE: 'https://api.example.test/v1///' } } }
  });

  expect(runtime.getDriver('demo-cli', 'channels').normalizeEndpoint('/models')).toBe('https://api.example.test/v1/models');
});

test('keeps OpenAI-compatible base URLs as URLs during manifest path resolution', () => {
  const { resolveManifestPaths } = require('../../../src/platforms/path-resolver');

  expect(resolveManifestPaths({
    key: 'demo-cli',
    paths: { home: '/tmp/demo', baseUrl: 'https://api.example.test/v1///' }
  })).toEqual({
    home: '/tmp/demo',
    baseUrl: 'https://api.example.test/v1///'
  });
});

test('production runtime allows no-home absolute generic MCP mappings', async () => {
  const root = fs.mkdtempSync(path.join('/var/tmp', 'runtime-generic-mcp-'));
  const file = path.join(root, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({ servers: { demo: { command: 'demo' } } }), 'utf8');
  const registry = createPlatformRegistry({
    builtIns: [],
    userFile: {
      platforms: [{
        key: 'demo-cli',
        label: 'Demo',
        command: 'demo',
        mcpFormat: 'json',
        resourceMappings: { mcp: file },
        capabilities: { mcp: 'generic-mcp' }
      }]
    }
  });
  try {
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });
    await expect(runtime.invoke('demo-cli', 'mcp', 'read')).resolves.toEqual({
      servers: { demo: { command: 'demo' } }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production runtime falls back to promptFile when prompts mapping is empty', async () => {
  const root = fs.mkdtempSync(path.join('/var/tmp', 'runtime-generic-prompt-'));
  const file = path.join(root, 'PROMPT.md');
  fs.writeFileSync(file, 'hello from promptFile', 'utf8');
  const registry = createPlatformRegistry({
    builtIns: [],
    userFile: {
      platforms: [{
        key: 'demo-cli',
        label: 'Demo',
        command: 'demo',
        promptFile: file,
        resourceMappings: { prompts: '' },
        capabilities: { prompts: 'generic-prompt' }
      }]
    }
  });
  try {
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });
    await expect(runtime.invoke('demo-cli', 'prompts', 'read')).resolves.toBe('hello from promptFile');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('production runtime still contains absolute generic mappings under a declared home', () => {
  const root = fs.mkdtempSync(path.join('/var/tmp', 'runtime-generic-contained-'));
  const home = path.join(root, 'home');
  const outside = path.join(root, 'outside.json');
  fs.mkdirSync(home);
  fs.writeFileSync(outside, '{}', 'utf8');
  const registry = createPlatformRegistry({
    builtIns: [],
    userFile: {
      platforms: [{
        key: 'demo-cli',
        label: 'Demo',
        command: 'demo',
        paths: { home },
        mcpFormat: 'json',
        resourceMappings: { mcp: outside },
        capabilities: { mcp: 'generic-mcp' }
      }]
    }
  });
  try {
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });
    expect(() => runtime.getDriver('demo-cli', 'mcp')).toThrow(/resource mapping mcp escapes home/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('production singleton creates drivers through the default registry', () => {
  const driver = { list: vi.fn(() => ['built-in-session']) };
  const defaultDriverRegistry = {
    create: vi.fn(() => driver)
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === './driver-registry'
    ? { getDriverRegistry: () => defaultDriverRegistry }
    : originalLoad(request, parent, isMain);
  delete require.cache[RUNTIME_PATH];

  try {
    const { getPlatformRuntime } = require('../../../src/platforms/runtime');
    const runtime = getPlatformRuntime();

    expect(runtime.getDriver('claude', 'sessions')).toBe(driver);
    expect(defaultDriverRegistry.create).toHaveBeenCalledWith('legacy:claude', {
      platform: 'claude',
      capability: 'sessions',
      manifest: expect.objectContaining({ key: 'claude' }),
      context: {},
      dependencies: {}
    });
  } finally {
    delete require.cache[RUNTIME_PATH];
    Module._load = originalLoad;
  }
});

test('production singleton throws clearly when no default driver registry is available', () => {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === './driver-registry'
    ? (() => {
      const error = new Error("Cannot find module './driver-registry'");
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    })()
    : originalLoad(request, parent, isMain);
  delete require.cache[RUNTIME_PATH];
  try {
    const { getPlatformRuntime } = require('../../../src/platforms/runtime');
    expect(() => getPlatformRuntime()).toThrow(/Platform driver registry is not available/);
  } finally {
    delete require.cache[RUNTIME_PATH];
    Module._load = originalLoad;
  }
});
