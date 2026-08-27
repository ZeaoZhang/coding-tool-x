'use strict';

const { validateManifest, normalizeManifestError } = require('../../../src/platforms/manifest-schema');

test('accepts a valid generic platform manifest', () => {
  const result = validateManifest({
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    iconToken: 'terminal',
    paths: { home: '~/.demo', sessions: '{home}/sessions' },
    capabilities: { sessions: 'generic-jsonl' }
  });

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
});

test('rejects executable module paths and unknown drivers', () => {
  const result = validateManifest({
    key: 'bad-cli',
    label: 'Bad',
    command: 'bad',
    driverModule: '/tmp/driver.js',
    capabilities: { sessions: 'user-code' }
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('driver');
});

test('rejects duplicate or malformed platform keys', () => {
  const result = validateManifest({
    key: 'Bad Key',
    label: 'Bad',
    command: 'bad',
    capabilities: {}
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('key');
});
