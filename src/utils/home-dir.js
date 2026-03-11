const path = require('path');

function isWindowsLikePlatform(platform = process.platform, env = process.env) {
  if (platform === 'win32' || platform === 'cygwin' || platform === 'msys') {
    return true;
  }

  const hasWindowsEnv = Boolean(env.SYSTEMROOT || env.WINDIR || env.COMSPEC || env.ComSpec);
  const hasWindowsHome = /^[a-zA-Z]:[\\/]/.test(env.USERPROFILE || '') ||
    (Boolean(env.HOMEDRIVE) && Boolean(env.HOMEPATH));
  return hasWindowsEnv && hasWindowsHome;
}

function normalizeWindowsHomePath(rawPath, env = process.env) {
  if (!rawPath || typeof rawPath !== 'string') {
    return '';
  }

  let value = rawPath.trim();
  if (!value) {
    return '';
  }

  const msysDriveMatch = value.match(/^\/([a-zA-Z])\/(.+)$/);
  if (msysDriveMatch) {
    const drive = msysDriveMatch[1].toUpperCase();
    const rest = msysDriveMatch[2].replace(/\//g, '\\');
    value = `${drive}:\\${rest}`;
  } else if (/^\/Users\//i.test(value)) {
    const drive = (env.SYSTEMDRIVE || env.HOMEDRIVE || 'C:').replace(/\\+$/, '');
    const rest = value.replace(/^\/+/, '').replace(/\//g, '\\');
    value = `${drive}\\${rest}`;
  } else {
    value = value.replace(/\//g, '\\');
  }

  if (/^[a-zA-Z]:[^\\]/.test(value)) {
    value = `${value.slice(0, 2)}\\${value.slice(2)}`;
  }

  if (!path.win32.isAbsolute(value)) {
    return '';
  }

  return path.win32.normalize(value);
}

function isGitInstallHomePath(homePath) {
  return /[\\/]Program Files[\\/]Git[\\/]Users[\\/]/i.test(homePath || '');
}

function resolvePreferredHomeDir(platform = process.platform, env = process.env, fallbackHome = '') {
  if (!isWindowsLikePlatform(platform, env)) {
    return fallbackHome;
  }

  const candidates = [];
  if (env.USERPROFILE) {
    candidates.push(env.USERPROFILE);
  }
  if (env.HOMEDRIVE && env.HOMEPATH) {
    candidates.push(`${env.HOMEDRIVE}${env.HOMEPATH}`);
  }
  if (env.HOME) {
    candidates.push(env.HOME);
  }
  candidates.push(fallbackHome);

  const normalizedCandidates = candidates
    .map(candidate => normalizeWindowsHomePath(candidate, env))
    .filter(Boolean);

  const preferredHome = normalizedCandidates.find(candidate => !isGitInstallHomePath(candidate));
  return preferredHome || normalizedCandidates[0] || fallbackHome;
}

module.exports = {
  isWindowsLikePlatform,
  normalizeWindowsHomePath,
  resolvePreferredHomeDir,
  isGitInstallHomePath
};
