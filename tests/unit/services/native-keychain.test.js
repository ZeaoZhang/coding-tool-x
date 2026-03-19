'use strict';

const childProcess = require('child_process');

const MODULE_PATH = require.resolve('../../../src/server/services/native-keychain');

let originalPlatformDescriptor;
let originalComSpec;
let spawnSyncSpy;
let keychain;

function setPlatform(platform) {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    enumerable: true,
    writable: false,
    value: platform
  });
}

beforeEach(() => {
  originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  originalComSpec = process.env.ComSpec;
  spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync');
  delete require.cache[MODULE_PATH];
  keychain = require('../../../src/server/services/native-keychain');
});

afterEach(() => {
  spawnSyncSpy.mockRestore();
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
  if (originalComSpec === undefined) {
    delete process.env.ComSpec;
  } else {
    process.env.ComSpec = originalComSpec;
  }
  delete require.cache[MODULE_PATH];
});

describe('native-keychain platform support', () => {
  test('detects support on darwin and linux', () => {
    setPlatform('darwin');
    expect(keychain.isSupported()).toBe(true);
    expect(spawnSyncSpy).not.toHaveBeenCalled();

    setPlatform('linux');
    spawnSyncSpy.mockReturnValue({ status: 1, stdout: '', stderr: '' });
    expect(keychain.isSupported()).toBe(true);
    expect(spawnSyncSpy).toHaveBeenCalledWith('secret-tool', ['--help'], expect.objectContaining({
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
  });

  test('returns false on linux when secret-tool is unavailable', () => {
    setPlatform('linux');
    spawnSyncSpy.mockImplementation(() => {
      throw new Error('secret-tool not found');
    });

    expect(keychain.isSupported()).toBe(false);
  });
});

describe('native-keychain get/set/delete password', () => {
  test('gets passwords on macOS and returns null for invalid input', () => {
    setPlatform('darwin');
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: 'secret-value\n', stderr: '' });

    expect(keychain.getPassword('cc-tool', 'demo')).toBe('secret-value');
    expect(keychain.getPassword('', 'demo')).toBeNull();
    expect(spawnSyncSpy).toHaveBeenCalledWith('security', [
      'find-generic-password',
      '-a',
      'demo',
      '-w',
      '-s',
      'cc-tool'
    ], expect.objectContaining({
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
  });

  test('stores passwords on linux by clearing existing values first', () => {
    setPlatform('linux');
    spawnSyncSpy
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    expect(keychain.setPassword('cc-tool', 'demo', 'next-secret')).toBe(true);
    expect(spawnSyncSpy).toHaveBeenNthCalledWith(1, 'secret-tool', [
      'clear',
      'service',
      'cc-tool',
      'account',
      'demo'
    ], expect.objectContaining({
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
    expect(spawnSyncSpy).toHaveBeenNthCalledWith(2, 'secret-tool', [
      'store',
      '--label',
      'cc-tool',
      'service',
      'cc-tool',
      'account',
      'demo'
    ], expect.objectContaining({
      input: 'next-secret',
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
  });

  test('uses PowerShell on Windows for read and delete operations', () => {
    setPlatform('win32');
    process.env.ComSpec = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    spawnSyncSpy
      .mockReturnValueOnce({ status: 0, stdout: 'windows-secret', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    expect(keychain.getPassword('cc-tool', 'demo')).toBe('windows-secret');
    expect(keychain.deletePassword('cc-tool', 'demo')).toBe(true);
    expect(spawnSyncSpy).toHaveBeenNthCalledWith(1,
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('PasswordVault')],
      expect.objectContaining({
        env: expect.objectContaining({
          CC_TOOL_SERVICE: 'cc-tool',
          CC_TOOL_ACCOUNT: 'demo'
        })
      })
    );
    expect(spawnSyncSpy).toHaveBeenNthCalledWith(2,
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('$vault.Remove')],
      expect.objectContaining({
        env: expect.objectContaining({
          CC_TOOL_SERVICE: 'cc-tool',
          CC_TOOL_ACCOUNT: 'demo'
        })
      })
    );
  });

  test('disable-native path deletes keychain entries on macOS', () => {
    setPlatform('darwin');
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    expect(keychain.deletePassword('Claude Code-credentials', 'demo')).toBe(true);
    expect(spawnSyncSpy).toHaveBeenCalledWith('security', [
      'delete-generic-password',
      '-a',
      'demo',
      '-s',
      'Claude Code-credentials'
    ], expect.objectContaining({
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
  });

  test('disable-native path deletes keychain entries on linux', () => {
    setPlatform('linux');
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    expect(keychain.deletePassword('Claude Code-credentials', 'demo')).toBe(true);
    expect(spawnSyncSpy).toHaveBeenCalledWith('secret-tool', [
      'clear',
      'service',
      'Claude Code-credentials',
      'account',
      'demo'
    ], expect.objectContaining({
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
  });

  test('disable-native path deletes keychain entries on windows', () => {
    setPlatform('win32');
    process.env.ComSpec = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    expect(keychain.deletePassword('Claude Code-credentials', 'demo')).toBe(true);
    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('$vault.Remove')],
      expect.objectContaining({
        env: expect.objectContaining({
          CC_TOOL_SERVICE: 'Claude Code-credentials',
          CC_TOOL_ACCOUNT: 'demo'
        })
      })
    );
  });
});
