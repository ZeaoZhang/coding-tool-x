'use strict';

const { _test } = require('../../../src/commands/stats');

describe('stats command helpers', () => {
  test('accepts OMP alias while keeping omp as the normalized type', () => {
    expect(_test.validateToolType('omp')).toBe(true);
    expect(_test.validateToolType('omp')).toBe(true);
    expect(_test.validateToolType('unknown')).toBe(false);
  });

  test('displays omp statistics as OMP', () => {
    expect(_test.getToolDisplayName('omp')).toBe('OMP');
    expect(_test.getToolDisplayName('omp')).toBe('OMP');
    expect(_test.getToolDisplayName('codex')).toBe('CODEX');
  });

  test('builds display payload with normalized omp type', () => {
    const payload = _test.buildDisplayPayload('omp', 'all', { requests: 1 });

    expect(payload).toEqual({
      type: 'omp',
      timeRange: 'all',
      summary: { requests: 1 },
      byToolType: null
    });
  });
});
