import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  saveProxyStartTime,
  getProxyStartTime,
  clearProxyStartTime,
  getProxyRuntime,
  formatRuntime
} from '../../../src/server/services/proxy-runtime.js';
import { PATHS } from '../../../src/config/paths.js';

// Use the real claude runtime path — manage state via backup/restore
const CLAUDE_PATH = PATHS.proxyRuntime.claude;
const BACKUP_PATH = CLAUDE_PATH + '.test-backup';

beforeEach(() => {
  // Back up any existing runtime file so tests start clean
  if (fs.existsSync(CLAUDE_PATH)) {
    fs.copyFileSync(CLAUDE_PATH, BACKUP_PATH);
    fs.unlinkSync(CLAUDE_PATH);
  }
});

afterEach(() => {
  // Remove any file written by the test
  if (fs.existsSync(CLAUDE_PATH)) fs.unlinkSync(CLAUDE_PATH);
  // Restore original if it existed
  if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, CLAUDE_PATH);
    fs.unlinkSync(BACKUP_PATH);
  }
});

describe('formatRuntime', () => {
  it('returns zero values for null input', () => {
    expect(formatRuntime(null)).toEqual({ hours: 0, minutes: 0, seconds: 0, formatted: '0秒' });
  });

  it('returns zero values for negative input', () => {
    expect(formatRuntime(-1000)).toEqual({ hours: 0, minutes: 0, seconds: 0, formatted: '0秒' });
  });

  it('returns zero values for zero input', () => {
    expect(formatRuntime(0)).toEqual({ hours: 0, minutes: 0, seconds: 0, formatted: '0秒' });
  });

  it('formats 5 seconds correctly', () => {
    expect(formatRuntime(5000)).toEqual({ hours: 0, minutes: 0, seconds: 5, formatted: '5秒' });
  });

  it('formats 1 hour 1 minute 1 second correctly', () => {
    expect(formatRuntime(3661000)).toEqual({ hours: 1, minutes: 1, seconds: 1, formatted: '1小时1分1秒' });
  });

  it('formats minutes and seconds without hours', () => {
    expect(formatRuntime(90000)).toEqual({ hours: 0, minutes: 1, seconds: 30, formatted: '1分30秒' });
  });

  it('formats hours and minutes with zero seconds', () => {
    expect(formatRuntime(3660000)).toEqual({ hours: 1, minutes: 1, seconds: 0, formatted: '1小时1分' });
  });

  it('formats exactly 1 hour', () => {
    expect(formatRuntime(3600000)).toEqual({ hours: 1, minutes: 0, seconds: 0, formatted: '1小时' });
  });

  it('formats exactly 1 minute', () => {
    expect(formatRuntime(60000)).toEqual({ hours: 0, minutes: 1, seconds: 0, formatted: '1分' });
  });

  it('truncates milliseconds (floor to seconds)', () => {
    expect(formatRuntime(5999)).toEqual({ hours: 0, minutes: 0, seconds: 5, formatted: '5秒' });
  });
});

describe('saveProxyStartTime', () => {
  it('writes file and returns data with startTime', () => {
    const before = Date.now();
    const result = saveProxyStartTime('claude');
    const after = Date.now();

    expect(result).not.toBeNull();
    expect(result.type).toBe('claude');
    expect(result.startTime).toBeGreaterThanOrEqual(before);
    expect(result.startTime).toBeLessThanOrEqual(after);
    expect(fs.existsSync(CLAUDE_PATH)).toBe(true);
  });

  it('preserves existing data when preserveExisting is true and file exists', () => {
    const existingData = { startTime: 1000000, type: 'claude' };
    fs.mkdirSync(path.dirname(CLAUDE_PATH), { recursive: true });
    fs.writeFileSync(CLAUDE_PATH, JSON.stringify(existingData), 'utf8');

    const result = saveProxyStartTime('claude', true);

    expect(result).toEqual(existingData);
    const onDisk = JSON.parse(fs.readFileSync(CLAUDE_PATH, 'utf8'));
    expect(onDisk).toEqual(existingData);
  });

  it('overwrites existing file when preserveExisting is false', () => {
    const oldData = { startTime: 1000, type: 'claude' };
    fs.mkdirSync(path.dirname(CLAUDE_PATH), { recursive: true });
    fs.writeFileSync(CLAUDE_PATH, JSON.stringify(oldData), 'utf8');

    const result = saveProxyStartTime('claude', false);

    expect(result.startTime).not.toBe(1000);
    expect(result.type).toBe('claude');
  });
});

describe('getProxyStartTime', () => {
  it('returns null when file does not exist', () => {
    expect(getProxyStartTime('claude')).toBeNull();
  });

  it('returns startTime from file when file exists', () => {
    const startTime = 1700000000000;
    fs.mkdirSync(path.dirname(CLAUDE_PATH), { recursive: true });
    fs.writeFileSync(CLAUDE_PATH, JSON.stringify({ startTime, type: 'claude' }), 'utf8');

    expect(getProxyStartTime('claude')).toBe(startTime);
  });

  it('returns null when file has no startTime field', () => {
    fs.mkdirSync(path.dirname(CLAUDE_PATH), { recursive: true });
    fs.writeFileSync(CLAUDE_PATH, JSON.stringify({ type: 'claude' }), 'utf8');

    expect(getProxyStartTime('claude')).toBeNull();
  });
});

describe('clearProxyStartTime', () => {
  it('deletes file when it exists', () => {
    fs.mkdirSync(path.dirname(CLAUDE_PATH), { recursive: true });
    fs.writeFileSync(CLAUDE_PATH, '{}', 'utf8');

    clearProxyStartTime('claude');

    expect(fs.existsSync(CLAUDE_PATH)).toBe(false);
  });

  it('does nothing when file does not exist', () => {
    expect(() => clearProxyStartTime('claude')).not.toThrow();
    expect(fs.existsSync(CLAUDE_PATH)).toBe(false);
  });
});

describe('getProxyRuntime', () => {
  it('returns null when no start time file exists', () => {
    expect(getProxyRuntime('claude')).toBeNull();
  });

  it('returns elapsed milliseconds when start time exists', () => {
    const startTime = Date.now() - 5000;
    fs.mkdirSync(path.dirname(CLAUDE_PATH), { recursive: true });
    fs.writeFileSync(CLAUDE_PATH, JSON.stringify({ startTime, type: 'claude' }), 'utf8');

    const result = getProxyRuntime('claude');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(5000);
    expect(result).toBeLessThan(10000);
  });
});
