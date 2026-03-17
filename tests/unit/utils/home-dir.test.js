const {
  isWindowsLikePlatform,
  normalizeWindowsHomePath,
  resolvePreferredHomeDir,
  isGitInstallHomePath,
} = require('../../../src/utils/home-dir');

describe('isWindowsLikePlatform', () => {
  it('returns true for win32 platform', () => {
    expect(isWindowsLikePlatform('win32', {})).toBe(true);
  });

  it('returns true for cygwin platform', () => {
    expect(isWindowsLikePlatform('cygwin', {})).toBe(true);
  });

  it('returns true for msys platform', () => {
    expect(isWindowsLikePlatform('msys', {})).toBe(true);
  });

  it('returns false for darwin platform with no Windows env', () => {
    expect(isWindowsLikePlatform('darwin', {})).toBe(false);
  });

  it('returns false for linux platform with no Windows env', () => {
    expect(isWindowsLikePlatform('linux', {})).toBe(false);
  });

  it('returns true for linux with SYSTEMROOT and Windows USERPROFILE', () => {
    const env = {
      SYSTEMROOT: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\foo',
    };
    expect(isWindowsLikePlatform('linux', env)).toBe(true);
  });

  it('returns true for linux with WINDIR and HOMEDRIVE+HOMEPATH', () => {
    const env = {
      WINDIR: 'C:\\Windows',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\foo',
    };
    expect(isWindowsLikePlatform('linux', env)).toBe(true);
  });

  it('returns true for linux with COMSPEC and Windows USERPROFILE', () => {
    const env = {
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      USERPROFILE: 'C:\\Users\\foo',
    };
    expect(isWindowsLikePlatform('linux', env)).toBe(true);
  });

  it('returns false for linux with Windows env indicators but no Windows home', () => {
    const env = {
      SYSTEMROOT: 'C:\\Windows',
      // no USERPROFILE, no HOMEDRIVE+HOMEPATH
    };
    expect(isWindowsLikePlatform('linux', env)).toBe(false);
  });

  it('returns false for darwin with no env vars', () => {
    expect(isWindowsLikePlatform('darwin', {})).toBe(false);
  });
});

describe('normalizeWindowsHomePath', () => {
  it('returns empty string for null', () => {
    expect(normalizeWindowsHomePath(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeWindowsHomePath(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeWindowsHomePath('')).toBe('');
  });

  it('returns empty string for whitespace-only string', () => {
    expect(normalizeWindowsHomePath('   ')).toBe('');
  });

  it('converts MSYS-style path /c/Users/foo to C:\\Users\\foo', () => {
    expect(normalizeWindowsHomePath('/c/Users/foo')).toBe('C:\\Users\\foo');
  });

  it('converts MSYS-style path with subdirectory', () => {
    expect(normalizeWindowsHomePath('/d/Projects/my-app')).toBe('D:\\Projects\\my-app');
  });

  it('converts /Users/ path using SYSTEMDRIVE from env', () => {
    const env = { SYSTEMDRIVE: 'D:' };
    expect(normalizeWindowsHomePath('/Users/foo', env)).toBe('D:\\Users\\foo');
  });

  it('converts /Users/ path using HOMEDRIVE from env when no SYSTEMDRIVE', () => {
    const env = { HOMEDRIVE: 'E:' };
    expect(normalizeWindowsHomePath('/Users/foo', env)).toBe('E:\\Users\\foo');
  });

  it('converts /Users/ path using default C: when no drive env vars', () => {
    expect(normalizeWindowsHomePath('/Users/foo', {})).toBe('C:\\Users\\foo');
  });

  it('returns already-Windows path normalized', () => {
    expect(normalizeWindowsHomePath('C:\\Users\\foo')).toBe('C:\\Users\\foo');
  });

  it('returns empty string for a relative path that is not absolute', () => {
    expect(normalizeWindowsHomePath('relative/path', {})).toBe('');
  });
});

describe('isGitInstallHomePath', () => {
  it('returns true for a Git install path with backslashes', () => {
    expect(isGitInstallHomePath('C:\\Program Files\\Git\\Users\\foo')).toBe(true);
  });

  it('returns true for a Git install path with forward slashes', () => {
    expect(isGitInstallHomePath('C:/Program Files/Git/Users/foo')).toBe(true);
  });

  it('returns true for case-insensitive match', () => {
    expect(isGitInstallHomePath('C:\\PROGRAM FILES\\GIT\\USERS\\foo')).toBe(true);
  });

  it('returns false for a normal user home path', () => {
    expect(isGitInstallHomePath('C:\\Users\\foo')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isGitInstallHomePath('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isGitInstallHomePath(null)).toBe(false);
  });

  it('returns false for a path containing Program Files but not Git', () => {
    expect(isGitInstallHomePath('C:\\Program Files\\SomeApp\\Users\\foo')).toBe(false);
  });
});

describe('resolvePreferredHomeDir', () => {
  it('returns fallbackHome on darwin (non-Windows)', () => {
    expect(resolvePreferredHomeDir('darwin', {}, '/Users/foo')).toBe('/Users/foo');
  });

  it('returns fallbackHome on linux (non-Windows)', () => {
    expect(resolvePreferredHomeDir('linux', {}, '/home/foo')).toBe('/home/foo');
  });

  it('returns USERPROFILE on win32 when it is not a Git install path', () => {
    const env = { USERPROFILE: 'C:\\Users\\foo' };
    expect(resolvePreferredHomeDir('win32', env, '')).toBe('C:\\Users\\foo');
  });

  it('prefers USERPROFILE over HOMEDRIVE+HOMEPATH on Windows', () => {
    const env = {
      USERPROFILE: 'C:\\Users\\foo',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\bar',
    };
    expect(resolvePreferredHomeDir('win32', env, '')).toBe('C:\\Users\\foo');
  });

  it('falls back to HOMEDRIVE+HOMEPATH when USERPROFILE is absent', () => {
    const env = {
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\bar',
    };
    expect(resolvePreferredHomeDir('win32', env, '')).toBe('C:\\Users\\bar');
  });

  it('skips Git install paths and picks next valid candidate', () => {
    const env = {
      USERPROFILE: 'C:\\Program Files\\Git\\Users\\foo',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\real',
    };
    const result = resolvePreferredHomeDir('win32', env, '');
    expect(isGitInstallHomePath(result)).toBe(false);
    expect(result).toBe('C:\\Users\\real');
  });

  it('returns fallbackHome when no valid candidates are found on Windows', () => {
    // win32 but no env vars that produce valid paths
    const result = resolvePreferredHomeDir('win32', {}, 'C:\\fallback');
    expect(result).toBe('C:\\fallback');
  });

  it('uses MSYS-style HOME env var as a candidate on Windows', () => {
    const env = {
      USERPROFILE: 'C:\\Program Files\\Git\\Users\\foo', // Git install - should be skipped
      HOME: '/c/Users/real',
    };
    const result = resolvePreferredHomeDir('win32', env, '');
    expect(result).toBe('C:\\Users\\real');
  });
});
