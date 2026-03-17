const { formatTime, formatSize, truncate } = require('../../../src/utils/format');

describe('formatTime', () => {
  it('returns 刚刚 for times less than 1 minute ago', () => {
    const date = new Date(Date.now() - 30 * 1000); // 30 seconds ago
    expect(formatTime(date)).toBe('刚刚');
  });

  it('returns 刚刚 for the current moment', () => {
    const date = new Date(Date.now() - 100); // 100ms ago
    expect(formatTime(date)).toBe('刚刚');
  });

  it('returns N分钟前 for times between 1 and 59 minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    expect(formatTime(date)).toBe('5分钟前');
  });

  it('returns 1分钟前 at the 1-minute boundary', () => {
    const date = new Date(Date.now() - 60 * 1000); // exactly 1 minute ago
    expect(formatTime(date)).toBe('1分钟前');
  });

  it('returns 59分钟前 just before the hour boundary', () => {
    const date = new Date(Date.now() - 59 * 60 * 1000); // 59 minutes ago
    expect(formatTime(date)).toBe('59分钟前');
  });

  it('returns N小时前 for times between 1 and 23 hours ago', () => {
    const date = new Date(Date.now() - 3 * 3600 * 1000); // 3 hours ago
    expect(formatTime(date)).toBe('3小时前');
  });

  it('returns 1小时前 at the 1-hour boundary', () => {
    const date = new Date(Date.now() - 60 * 60 * 1000); // exactly 1 hour ago
    expect(formatTime(date)).toBe('1小时前');
  });

  it('returns 23小时前 just before the day boundary', () => {
    const date = new Date(Date.now() - 23 * 3600 * 1000); // 23 hours ago
    expect(formatTime(date)).toBe('23小时前');
  });

  it('returns N天前 for times between 1 and 29 days ago', () => {
    const date = new Date(Date.now() - 7 * 86400 * 1000); // 7 days ago
    expect(formatTime(date)).toBe('7天前');
  });

  it('returns 1天前 at the 1-day boundary', () => {
    const date = new Date(Date.now() - 24 * 3600 * 1000); // exactly 1 day ago
    expect(formatTime(date)).toBe('1天前');
  });

  it('returns 29天前 just before the 30-day boundary', () => {
    const date = new Date(Date.now() - 29 * 86400 * 1000); // 29 days ago
    expect(formatTime(date)).toBe('29天前');
  });

  it('returns locale date string for times 30 or more days ago', () => {
    const date = new Date(Date.now() - 30 * 86400 * 1000); // 30 days ago
    expect(formatTime(date)).toBe(date.toLocaleDateString('zh-CN'));
  });

  it('returns locale date string for very old dates', () => {
    const date = new Date('2020-01-01');
    expect(formatTime(date)).toBe(date.toLocaleDateString('zh-CN'));
  });
});

describe('formatSize', () => {
  it('returns 0B for zero bytes', () => {
    expect(formatSize(0)).toBe('0B');
  });

  it('returns bytes with B suffix for values less than 1024', () => {
    expect(formatSize(512)).toBe('512B');
  });

  it('returns 1023B at the byte/KB boundary (exclusive)', () => {
    expect(formatSize(1023)).toBe('1023B');
  });

  it('returns KB for exactly 1024 bytes', () => {
    expect(formatSize(1024)).toBe('1.0KB');
  });

  it('returns KB for values in the KB range', () => {
    expect(formatSize(2048)).toBe('2.0KB');
  });

  it('returns KB with one decimal place', () => {
    expect(formatSize(1536)).toBe('1.5KB');
  });

  it('returns KB just below the MB boundary', () => {
    const justBelowMB = 1024 * 1024 - 1;
    const expected = (justBelowMB / 1024).toFixed(1) + 'KB';
    expect(formatSize(justBelowMB)).toBe(expected);
  });

  it('returns MB for exactly 1024*1024 bytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0MB');
  });

  it('returns MB for large values', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0MB');
  });

  it('returns MB with one decimal place for non-round MB values', () => {
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5MB');
  });
});

describe('truncate', () => {
  it('returns empty string for null', () => {
    expect(truncate(null, 10)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(truncate(undefined, 10)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('collapses multiple spaces into one', () => {
    expect(truncate('hello   world', 20)).toBe('hello world');
  });

  it('collapses tabs and newlines into single spaces', () => {
    expect(truncate('hello\t\nworld', 20)).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(truncate('  hello world  ', 20)).toBe('hello world');
  });

  it('returns text as-is when length equals maxLength', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('returns text as-is when length is less than maxLength', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('truncates and appends ellipsis when text exceeds maxLength', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });

  it('truncates after whitespace collapsing', () => {
    expect(truncate('hello   world extra', 11)).toBe('hello world...');
  });
});
