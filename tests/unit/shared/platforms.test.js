'use strict';

const {
  DEFAULT_ENABLED_CLI_PLATFORMS,
  getPlatformDefinition,
  normalizeCustomCliPlatform,
  normalizeEnabledCliPlatforms,
  normalizePlatformKey,
  migrateLegacyCliConfig
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
});

describe('legacy homepage helper compatibility', () => {
  test('normalizes explicit built-in keys without filling obsolete defaults', () => {
    const { normalizeHomeCliColumns } = require('../../../src/shared/platforms');
    expect(normalizeHomeCliColumns([' OMP ', 'omp', 'unknown', 'CLAUDE'])).toEqual(['omp', 'claude']);
    expect(normalizeHomeCliColumns([])).toEqual([]);
  });
});

describe('enabled CLI platform helpers', () => {
  const allowedKeys = ['claude', 'codex', 'opencode', 'omp', 'demo-cli'];

  test('normalizes keys, deduplicates in first-seen order, and keeps more than four values', () => {
    expect(normalizeEnabledCliPlatforms(
      [' CLAUDE ', 'codex', 'claude', ' DEMO-CLI ', 'opencode', 'omp'],
      allowedKeys,
      DEFAULT_ENABLED_CLI_PLATFORMS
    )).toEqual(['claude', 'codex', 'demo-cli', 'opencode', 'omp']);
  });

  test('preserves an explicitly empty enabled list', () => {
    expect(normalizeEnabledCliPlatforms([], allowedKeys, DEFAULT_ENABLED_CLI_PLATFORMS)).toEqual([]);
  });

  test('rejects keys absent from the allowed registry', () => {
    expect(normalizeEnabledCliPlatforms(
      ['claude', 'custom-cli', ' CODEX '],
      ['claude', 'codex'],
      DEFAULT_ENABLED_CLI_PLATFORMS
    )).toEqual(['claude', 'codex']);
  });

  test('uses a normalized filtered fallback for non-array input', () => {
    expect(normalizeEnabledCliPlatforms(null, ['codex'], [' CLAUDE ', 'CODEX', 'codex'])).toEqual(['codex']);
  });

  test('migrates the exact old default to the new default', () => {
    expect(migrateLegacyCliConfig({
      homeCliColumns: ['claude', 'codex', 'gemini', 'opencode'],
      allowedKeys: ['claude', 'codex', 'gemini', 'opencode', 'omp']
    })).toEqual(DEFAULT_ENABLED_CLI_PLATFORMS);
  });

  test('does not treat an old default with an unknown extra as the exact old default', () => {
    expect(migrateLegacyCliConfig({
      homeCliColumns: ['claude', 'codex', 'gemini', 'opencode', 'unknown'],
      allowedKeys: ['claude', 'codex', 'gemini', 'opencode', 'omp']
    })).toEqual(['claude', 'codex', 'gemini', 'opencode', 'omp']);
  });

  test('keeps valid legacy order, appends missing defaults, and discards custom metadata', () => {
    expect(migrateLegacyCliConfig({
      homeCliColumns: [' OMP ', 'custom-cli', 'CLAUDE', 'demo-cli'],
      customCliPlatforms: [{ key: 'custom-cli', command: 'arbitrary-code' }],
      allowedKeys: ['claude', 'codex', 'opencode', 'omp']
    })).toEqual(['omp', 'claude', 'codex', 'opencode']);
  });

  test('uses dashboard order when home columns are absent', () => {
    expect(migrateLegacyCliConfig({
      dashboardChannelOrder: ['OPENCODE', 'claude'],
      allowedKeys: ['claude', 'codex', 'opencode', 'omp']
    })).toEqual(['opencode', 'claude', 'codex', 'omp']);
  });

  test('preserves explicit enabled values without adding defaults', () => {
    expect(migrateLegacyCliConfig({
      enabledCliPlatforms: [' OMP ', 'demo-cli', 'omp'],
      homeCliColumns: ['claude'],
      customCliPlatforms: [{ key: 'demo-cli', command: 'arbitrary-code' }],
      allowedKeys: ['claude', 'omp']
    })).toEqual(['omp']);
  });

  test('falls back when no legacy or default key is allowed', () => {
    expect(migrateLegacyCliConfig({
      homeCliColumns: ['unknown'],
      allowedKeys: ['demo-cli'],
      fallback: ['demo-cli']
    })).toEqual(['demo-cli']);
  });
});
