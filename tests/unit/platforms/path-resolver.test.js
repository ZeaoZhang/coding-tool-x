'use strict';

const Module = require('module');
const PATH_RESOLVER_PATH = require.resolve('../../../src/platforms/path-resolver');

const { resolveManifestPaths } = require('../../../src/platforms/path-resolver');

test('expands home and environment values without touching the real home directory', () => {
  const paths = resolveManifestPaths({
    key: 'demo-cli',
    paths: { home: '$DEMO_HOME', sessions: '{home}/sessions' }
  }, { env: { DEMO_HOME: '/tmp/demo-home' }, homeDir: '/tmp/test-home' });

  expect(paths).toEqual({
    home: '/tmp/demo-home',
    sessions: '/tmp/demo-home/sessions'
  });
});

test('uses the injected OMP command runner for special native paths', () => {
  const paths = resolveManifestPaths({ key: 'omp', pathResolverId: 'omp' }, {
    env: { OMP_COMMAND: 'omp' },
    commandRunner: () => '/tmp/omp-agent\n'
  });

  expect(paths.home).toBe('/tmp/omp-agent');
});

test('rejects an empty required home path', () => {
  expect(() => resolveManifestPaths({
    key: 'demo-cli',
    paths: { home: '$DEMO_HOME' }
  }, { env: { DEMO_HOME: '' }, homeDir: '/tmp/test-home' })).toThrow(/non-empty home path/);
});

test('rejects templated paths that escape home', () => {
  expect(() => resolveManifestPaths({
    key: 'demo-cli',
    paths: { home: '/tmp/demo-home', sessions: '{home}/../outside' }
  }, { homeDir: '/tmp/test-home' })).toThrow(/escapes home/);
});

test('rejects relative home paths that escape the injected home directory', () => {
  expect(() => resolveManifestPaths({
    key: 'demo-cli',
    paths: { home: '../outside' }
  }, { homeDir: '/tmp/test-home' })).toThrow(/escapes home/);
});

test('allows explicit absolute home paths outside the injected home directory', () => {
  expect(resolveManifestPaths({
    key: 'demo-cli',
    paths: { home: '/tmp/outside' }
  }, { homeDir: '/tmp/test-home' })).toEqual({ home: '/tmp/outside' });
});

test('declarative resolution does not load native PATHS configuration', () => {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === '../config/paths'
    ? (() => { throw new Error('config paths loaded'); })()
    : originalLoad(request, parent, isMain);
  delete require.cache[PATH_RESOLVER_PATH];
  try {
    const { resolveManifestPaths: resolveWithoutNativeConfig } = require('../../../src/platforms/path-resolver');
    expect(resolveWithoutNativeConfig({
      key: 'demo-cli',
      paths: { home: '$DEMO_HOME', sessions: '{home}/sessions' }
    }, { env: { DEMO_HOME: '/tmp/demo-home' }, homeDir: '/tmp/test-home' })).toEqual({
      home: '/tmp/demo-home',
      sessions: '/tmp/demo-home/sessions'
    });
  } finally {
    delete require.cache[PATH_RESOLVER_PATH];
    Module._load = originalLoad;
  }
});

test('native resolvers use injected homeDir before loading native PATHS configuration', () => {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === '../config/paths'
    ? (() => { throw new Error('config paths loaded'); })()
    : originalLoad(request, parent, isMain);
  delete require.cache[PATH_RESOLVER_PATH];
  try {
    const { resolveManifestPaths: resolveWithoutNativeConfig } = require('../../../src/platforms/path-resolver');
    expect(resolveWithoutNativeConfig({ key: 'claude', pathResolverId: 'claude' }, { homeDir: '/tmp/test-home' }).home)
      .toBe('/tmp/test-home/.claude');
    expect(resolveWithoutNativeConfig({ key: 'codex', pathResolverId: 'codex' }, { homeDir: '/tmp/test-home' }).home)
      .toBe('/tmp/test-home/.codex');
    expect(resolveWithoutNativeConfig({ key: 'gemini', pathResolverId: 'gemini' }, { homeDir: '/tmp/test-home' }).home)
      .toBe('/tmp/test-home/.gemini');
    expect(resolveWithoutNativeConfig({ key: 'opencode', pathResolverId: 'opencode' }, { homeDir: '/tmp/test-home' }).home)
      .toBe('/tmp/test-home/.config/opencode');
  } finally {
    delete require.cache[PATH_RESOLVER_PATH];
    Module._load = originalLoad;
  }
});
