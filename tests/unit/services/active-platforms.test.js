'use strict';

const { filterEnabledPlatforms } = require('../../../src/server/services/active-platforms');

const platforms = [
  { key: 'claude' },
  { key: 'Codex' },
  { key: 'omp' }
];

describe('filterEnabledPlatforms', () => {
  test('keeps every platform when the UI config declares no selection', () => {
    expect(filterEnabledPlatforms(platforms, null)).toEqual(platforms);
  });

  test('keeps only the selected platforms, case-insensitively', () => {
    expect(filterEnabledPlatforms(platforms, new Set(['codex', 'omp']))).toEqual([
      { key: 'Codex' },
      { key: 'omp' }
    ]);
  });

  test('honors an explicitly empty selection', () => {
    expect(filterEnabledPlatforms(platforms, new Set())).toEqual([]);
  });
});
