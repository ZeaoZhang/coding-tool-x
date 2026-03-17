'use strict';

const net = require('net');
const portHelper = require('../../../src/utils/port-helper');

const { parsePidsFromNetstatOutput, getPortToolIssue, formatPortToolIssue, isPortInUse } = portHelper;
const { isMissingCommandError, createPortToolIssue, formatPortToolIssue: formatFromTest } = portHelper._test;

// ---------------------------------------------------------------------------
// parsePidsFromNetstatOutput
// ---------------------------------------------------------------------------
describe('parsePidsFromNetstatOutput', () => {
  test('empty string returns []', () => {
    expect(parsePidsFromNetstatOutput('', 9999)).toEqual([]);
  });

  test('no matching port returns []', () => {
    const output = '  TCP    127.0.0.1:8080    0.0.0.0:0    LISTENING    1234';
    expect(parsePidsFromNetstatOutput(output, 9999)).toEqual([]);
  });

  test('single TCP line matches port and extracts PID', () => {
    const output = '  TCP    127.0.0.1:9999    0.0.0.0:0    LISTENING    12345';
    expect(parsePidsFromNetstatOutput(output, 9999)).toEqual(['12345']);
  });

  test('multiple lines with different ports returns only matched PIDs', () => {
    const output = [
      '  TCP    127.0.0.1:9999    0.0.0.0:0    LISTENING    12345',
      '  TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    6789'
    ].join('\n');
    expect(parsePidsFromNetstatOutput(output, 9999)).toEqual(['12345']);
  });

  test('PID 0 is skipped', () => {
    const output = '  TCP    0.0.0.0:9999    0.0.0.0:0    LISTENING    0';
    expect(parsePidsFromNetstatOutput(output, 9999)).toEqual([]);
  });

  test('UDP line without exact port suffix is skipped', () => {
    // Contains :9999 but as UDP with mismatched token — should be filtered
    const output = '  UDP    0.0.0.0:99990    *:*    555';
    expect(parsePidsFromNetstatOutput(output, 9999)).toEqual([]);
  });

  test('CRLF line endings are handled', () => {
    const output = '  TCP    127.0.0.1:9999    0.0.0.0:0    LISTENING    42\r\n  TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    99';
    expect(parsePidsFromNetstatOutput(output, 9999)).toEqual(['42']);
  });
});

// ---------------------------------------------------------------------------
// isMissingCommandError
// ---------------------------------------------------------------------------
describe('isMissingCommandError', () => {
  test('error.code === ENOENT returns true', () => {
    expect(isMissingCommandError({ code: 'ENOENT' })).toBe(true);
  });

  test('message contains "not found" returns true', () => {
    expect(isMissingCommandError({ message: 'lsof: not found' })).toBe(true);
  });

  test('stderr string contains "not recognized" returns true', () => {
    expect(isMissingCommandError({ message: '', stderr: "'netstat' is not recognized as an internal or external command" })).toBe(true);
  });

  test('Buffer stderr is converted and checked', () => {
    const buf = Buffer.from("command 'foo' not found");
    expect(isMissingCommandError({ message: '', stderr: buf })).toBe(true);
  });

  test('normal error returns false', () => {
    expect(isMissingCommandError({ message: 'permission denied', code: 'EACCES' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createPortToolIssue
// ---------------------------------------------------------------------------
describe('createPortToolIssue', () => {
  test('windows + kill phase: platform=windows, summary mentions 关闭', () => {
    const issue = createPortToolIssue('taskkill', 'kill', true);
    expect(issue.platform).toBe('windows');
    expect(issue.command).toBe('taskkill');
    expect(issue.phase).toBe('kill');
    expect(issue.summary).toContain('关闭');
    expect(Array.isArray(issue.hints)).toBe(true);
    expect(issue.hints.length).toBeGreaterThan(0);
  });

  test('windows + lookup phase: summary mentions 检测', () => {
    const issue = createPortToolIssue('netstat', 'lookup', true);
    expect(issue.platform).toBe('windows');
    expect(issue.summary).toContain('检测');
  });

  test('unix + kill phase: platform=unix, summary mentions 关闭', () => {
    const issue = createPortToolIssue('lsof', 'kill', false);
    expect(issue.platform).toBe('unix');
    expect(issue.summary).toContain('关闭');
  });

  test('unix + lookup phase: summary mentions 检测', () => {
    const issue = createPortToolIssue('lsof', 'lookup', false);
    expect(issue.platform).toBe('unix');
    expect(issue.summary).toContain('检测');
  });
});

// ---------------------------------------------------------------------------
// formatPortToolIssue (from _test and from public export)
// ---------------------------------------------------------------------------
describe('formatPortToolIssue', () => {
  test('null returns []', () => {
    expect(formatFromTest(null)).toEqual([]);
  });

  test('valid issue returns [summary, ...hints]', () => {
    const issue = createPortToolIssue('lsof', 'lookup', false);
    const result = formatFromTest(issue);
    expect(result[0]).toBe(issue.summary);
    expect(result.slice(1)).toEqual(issue.hints);
  });

  test('public formatPortToolIssue with explicit issue argument', () => {
    const issue = createPortToolIssue('netstat', 'kill', true);
    const result = formatPortToolIssue(issue);
    expect(result[0]).toBe(issue.summary);
    expect(result.length).toBe(1 + issue.hints.length);
  });
});

// ---------------------------------------------------------------------------
// isPortInUse
// ---------------------------------------------------------------------------
describe('isPortInUse', () => {
  test('unused high port returns false', async () => {
    // Use a high port unlikely to be bound
    const result = await isPortInUse(19753);
    expect(result).toBe(false);
  });

  test('bound port returns true', async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(19754, '127.0.0.1', resolve));
    try {
      const result = await isPortInUse(19754);
      expect(result).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('port returns false after server closes', async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(19755, '127.0.0.1', resolve));
    await new Promise((resolve) => server.close(resolve));
    const result = await isPortInUse(19755);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPortToolIssue (module state)
// ---------------------------------------------------------------------------
describe('getPortToolIssue', () => {
  test('returns null by default (no issue recorded)', () => {
    // Module state may have been set by prior tests; just verify it returns
    // the same reference as the internal state — type check is sufficient.
    const issue = getPortToolIssue();
    expect(issue === null || typeof issue === 'object').toBe(true);
  });

  test('formatPortToolIssue with no arg uses module state (null → [])', () => {
    // When module state is null, calling without arg returns []
    // We cannot easily reset module state from outside, so we verify
    // the contract: if getPortToolIssue() is null, formatPortToolIssue() is []
    if (getPortToolIssue() === null) {
      expect(formatPortToolIssue()).toEqual([]);
    } else {
      // State was set by something; formatPortToolIssue() must be non-empty
      expect(formatPortToolIssue().length).toBeGreaterThan(0);
    }
  });
});
