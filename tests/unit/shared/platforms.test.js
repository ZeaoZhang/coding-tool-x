'use strict';

const {
  DEFAULT_ENABLED_CLI_PLATFORMS,
  getPlatformDefinition,
  normalizeEnabledCliPlatforms,
  normalizePlatformKey,
  migrateLegacyCliConfig
} = require('../../../src/shared/platforms');

const sharedPlatforms = require('../../../src/shared/platforms');

describe('shared platform aliases', () => {
  test('normalizes omp to the persisted omp platform key', () => {
    expect(normalizePlatformKey('omp')).toBe('omp');
    expect(normalizePlatformKey(' OMP ')).toBe('omp');
  });

  test('resolves platform definitions through aliases', () => {
    expect(getPlatformDefinition('omp')).toEqual(expect.objectContaining({
      key: 'omp',
      label: 'OMP'
    }));
  });

  test('does not expose legacy custom or home-column helpers', () => {
    expect(sharedPlatforms).not.toHaveProperty('DEFAULT_HOME_CLI_COLUMNS');
    expect(sharedPlatforms).not.toHaveProperty('MAX_HOME_CLI_COLUMNS');
    expect(sharedPlatforms).not.toHaveProperty('normalizeCustomCliPlatform');
    expect(sharedPlatforms).not.toHaveProperty('normalizeCustomCliPlatforms');
    expect(sharedPlatforms).not.toHaveProperty('normalizeHomeCliColumns');
  });
});

describe('enabled CLI platform helpers', () => {
  const allowedKeys = ['claude', 'codex', 'gemini', 'opencode', 'omp', 'demo-cli'];

  test('uses the canonical default enabled order', () => {
    expect(DEFAULT_ENABLED_CLI_PLATFORMS).toEqual(['claude', 'codex', 'opencode', 'omp']);
    expect(normalizeEnabledCliPlatforms(undefined, allowedKeys)).toEqual(DEFAULT_ENABLED_CLI_PLATFORMS);
  });

  test('normalizes keys, deduplicates in first-seen order, and keeps more than four values', () => {
    expect(normalizeEnabledCliPlatforms(
      [' CLAUDE ', 'codex', 'claude', 'gemini', ' DEMO-CLI ', 'opencode', 'omp'],
      allowedKeys,
      DEFAULT_ENABLED_CLI_PLATFORMS
    )).toEqual(['claude', 'codex', 'gemini', 'demo-cli', 'opencode', 'omp']);
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
      allowedKeys
    })).toEqual(DEFAULT_ENABLED_CLI_PLATFORMS);
  });

  test('does not treat an old default with an unknown extra as the exact old default', () => {
    expect(migrateLegacyCliConfig({
      homeCliColumns: ['claude', 'codex', 'gemini', 'opencode', 'unknown'],
      allowedKeys
    })).toEqual(['claude', 'codex', 'gemini', 'opencode', 'omp']);
  });

  test('keeps valid legacy order, appends missing defaults, and discards custom metadata', () => {
    expect(migrateLegacyCliConfig({
      homeCliColumns: [' OMP ', 'custom-cli', 'CLAUDE', 'demo-cli'],
      customCliPlatforms: [{ key: 'custom-cli', command: 'arbitrary-code', icon: 'run arbitrary code' }],
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

  test('uses the new default when no legacy key is valid', () => {
    expect(migrateLegacyCliConfig({
      homeCliColumns: ['unknown'],
      allowedKeys
    })).toEqual(DEFAULT_ENABLED_CLI_PLATFORMS);
  });

  test('is idempotent after canonical migration', () => {
    const migrated = migrateLegacyCliConfig({
      dashboardChannelOrder: ['demo-cli', 'claude'],
      allowedKeys
    });

    expect(migrateLegacyCliConfig({
      enabledCliPlatforms: migrated,
      homeCliColumns: ['claude', 'codex', 'gemini', 'opencode'],
      customCliPlatforms: [{ key: 'ignored', command: 'arbitrary-code' }],
      allowedKeys
    })).toEqual(migrated);
  });
});