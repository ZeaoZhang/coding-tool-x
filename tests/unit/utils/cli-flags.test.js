const { hasHostFlag } = require('../../../src/utils/cli-flags');

describe('cli host flags', () => {
  test('recognizes --host and --hosts', () => {
    expect(hasHostFlag(['node', 'ctx', '--host'])).toBe(true);
    expect(hasHostFlag(['node', 'ctx', '--hosts'])).toBe(true);
  });

  test('ignores other flags', () => {
    expect(hasHostFlag(['node', 'ctx', '--https'])).toBe(false);
  });
});
