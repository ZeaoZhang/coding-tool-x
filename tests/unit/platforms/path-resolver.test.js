'use strict';

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
