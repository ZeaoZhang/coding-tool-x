'use strict';

let getPathBaseName;

beforeAll(async () => {
  ({ getPathBaseName } = await import('../../../src/web/src/utils/path.js'));
});

describe('web path utils', () => {
  test('returns basename for unix-style paths', () => {
    expect(getPathBaseName('/tmp/workspace/app')).toBe('app');
  });

  test('returns basename for Windows-style paths', () => {
    expect(getPathBaseName('C:\\Users\\alice\\workspace\\app')).toBe('app');
  });

  test('handles trailing separators', () => {
    expect(getPathBaseName('C:\\Users\\alice\\workspace\\app\\')).toBe('app');
  });

  test('returns empty string for blank input', () => {
    expect(getPathBaseName('')).toBe('');
  });
});
