'use strict';

const {
  getPlatformDefinition,
  normalizeCustomCliPlatform,
  normalizeHomeCliColumns,
  normalizePlatformKey
} = require('../../../src/shared/platforms');

describe('shared platform aliases', () => {
  test('normalizes omp to the persisted omp platform key', () => {
    expect(normalizePlatformKey('omp')).toBe('omp');
    expect(normalizePlatformKey(' OMP ')).toBe('omp');
    expect(normalizePlatformKey('omp')).toBe('omp');
  });

  test('resolves platform definitions through aliases', () => {
    expect(getPlatformDefinition('omp')).toEqual(expect.objectContaining({
      key: 'omp',
      label: 'OMP'
    }));
  });

  test('rejects aliased built-ins as custom platform keys', () => {
    expect(normalizeCustomCliPlatform({ key: 'omp', name: 'Custom OMP' })).toBeNull();
  });

  test('normalizes aliased home columns without duplicating omp', () => {
    expect(normalizeHomeCliColumns(['omp', 'omp', 'claude'])).toEqual(['omp', 'claude', 'codex', 'gemini']);
  });
});
