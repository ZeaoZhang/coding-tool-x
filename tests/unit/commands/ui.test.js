'use strict';

const ui = require('../../../src/commands/ui');

describe('Windows browser launcher', () => {
  test('builds a hidden non-interactive PowerShell launch spec', () => {
    const spec = ui._test.buildWindowsOpenSpec('http://localhost:19999', {
      SystemRoot: 'C:\\Windows'
    });

    expect(spec.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(spec.args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "Start-Process -FilePath 'http://localhost:19999'"
    ]);
    expect(spec.options).toEqual(expect.objectContaining({
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }));
  });

  test('does not use the open package on Windows', async () => {
    const spawnImpl = vi.fn(() => ({ unref: vi.fn() }));
    const openImpl = vi.fn();

    await ui._test.openUrl('http://localhost:19999', {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      spawnImpl,
      openImpl
    });

    expect(openImpl).not.toHaveBeenCalled();
    expect(spawnImpl).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      expect.arrayContaining(['-NoProfile', '-NonInteractive']),
      expect.objectContaining({ windowsHide: true, stdio: 'ignore' })
    );
  });
});
