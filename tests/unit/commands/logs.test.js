'use strict';

const { _test } = require('../../../src/commands/logs');

describe('logs command helpers', () => {
  test('supports omp and omp log aliases', () => {
    expect(_test.getSupportedLogTypes()).toEqual(
      expect.arrayContaining(['ui', 'claude', 'codex', 'gemini', 'opencode', 'omp', 'omp'])
    );
  });

  test('resolves omp and omp logs to UI/server log with explanatory note', () => {
    expect(_test.resolveLogType('omp')).toEqual(expect.objectContaining({
      normalizedType: 'omp',
      type: 'ui',
      file: 'cc-tool-out.log',
      note: expect.stringContaining('OMP')
    }));
    expect(_test.resolveLogType('omp')).toEqual(expect.objectContaining({
      normalizedType: 'omp',
      type: 'ui',
      file: 'cc-tool-out.log',
      note: expect.stringContaining('OMP')
    }));
  });
});
