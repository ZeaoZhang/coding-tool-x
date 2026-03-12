const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PATHS, HOME_DIR } = require('../../config/paths');

const PROFILE_MARKER_START = '# >>> coding-tool codex env >>>';
const PROFILE_MARKER_END = '# <<< coding-tool codex env <<<';

function defaultEnvFilePath(configDir) {
  return path.join(configDir, 'codex-env.sh');
}

function defaultStateFilePath(configDir) {
  return path.join(configDir, 'codex-env-state.json');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function hasValue(value) {
  return String(value || '').trim() !== '';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildHomeRelativeShellPath(filePath, homeDir) {
  const normalizedHome = path.resolve(homeDir);
  const normalizedFilePath = path.resolve(filePath);
  if (normalizedFilePath === normalizedHome) {
    return '$HOME';
  }
  if (normalizedFilePath.startsWith(`${normalizedHome}${path.sep}`)) {
    const relativePath = normalizedFilePath.slice(normalizedHome.length).replace(/\\/g, '/');
    return `$HOME${relativePath}`;
  }
  return normalizedFilePath.replace(/\\/g, '/');
}

function buildSourceSnippet(envFilePath, homeDir) {
  const shellPath = buildHomeRelativeShellPath(envFilePath, homeDir);
  return [
    PROFILE_MARKER_START,
    `[ -f "${shellPath}" ] && . "${shellPath}"`,
    PROFILE_MARKER_END
  ].join('\n');
}

function stripManagedBlock(content = '') {
  if (!content.includes(PROFILE_MARKER_START)) {
    return content;
  }
  const pattern = new RegExp(
    `\\n?${escapeRegex(PROFILE_MARKER_START)}[\\s\\S]*?${escapeRegex(PROFILE_MARKER_END)}\\n?`,
    'g'
  );
  return content.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertManagedBlock(content, snippet) {
  const stripped = stripManagedBlock(content);
  if (!stripped.trim()) {
    return `${snippet}\n`;
  }
  return `${stripped.trimEnd()}\n\n${snippet}\n`;
}

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallbackValue;
  }
}

function writeJsonFile(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function readState(stateFilePath) {
  const state = readJsonFile(stateFilePath, {
    version: 1,
    values: {},
    profiles: []
  });
  return {
    version: 1,
    values: state && typeof state.values === 'object' ? state.values : {},
    profiles: Array.isArray(state?.profiles) ? state.profiles : []
  };
}

function normalizeEnvMap(envMap = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(envMap || {})) {
    if (!key || !hasValue(value)) continue;
    normalized[String(key).trim()] = String(value);
  }
  return normalized;
}

function buildNextEnvValues(previousValues, envMap, { replace = true, removeKeys = [] } = {}) {
  const nextValues = replace
    ? {}
    : { ...previousValues };

  if (replace) {
    Object.assign(nextValues, normalizeEnvMap(envMap));
  } else {
    const normalizedIncoming = normalizeEnvMap(envMap);
    for (const [key, value] of Object.entries(normalizedIncoming)) {
      nextValues[key] = value;
    }
  }

  for (const key of removeKeys || []) {
    delete nextValues[key];
  }

  for (const [key, value] of Object.entries(nextValues)) {
    if (!hasValue(value)) {
      delete nextValues[key];
    }
  }

  return nextValues;
}

function getPosixProfileCandidates(homeDir, shellEnv = process.env) {
  const candidates = [
    '.bashrc',
    '.bash_profile',
    '.bash_login',
    '.zshrc',
    '.zshenv',
    '.zprofile',
    '.zlogin',
    '.profile'
  ].map(fileName => path.join(homeDir, fileName));

  const shell = String(shellEnv.SHELL || '').toLowerCase();
  const preferred = shell.includes('zsh')
    ? path.join(homeDir, '.zshrc')
    : shell.includes('bash')
      ? path.join(homeDir, '.bashrc')
      : path.join(homeDir, '.profile');

  return {
    preferred,
    candidates
  };
}

function writeTextFileIfChanged(filePath, content) {
  const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (previous === content) {
    return false;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function syncPosixEnvironment(nextValues, previousState, options) {
  const {
    runtime,
    homeDir,
    stateFilePath,
    shellEnv,
    execSync
  } = options;
  const nextKeys = Object.keys(nextValues).sort();
  let changed = false;

  // 清理旧版本遗留的 shell profile 注入（迁移兼容）
  const previousProfiles = Array.isArray(previousState.profiles) ? previousState.profiles : [];
  if (previousProfiles.length > 0) {
    const { candidates } = getPosixProfileCandidates(homeDir, shellEnv);
    const cleanupTargets = new Set([
      ...previousProfiles,
      ...candidates.filter(filePath => fs.existsSync(filePath))
    ]);
    for (const profilePath of cleanupTargets) {
      if (!fs.existsSync(profilePath)) continue;
      const currentContent = fs.readFileSync(profilePath, 'utf8');
      if (!currentContent.includes(PROFILE_MARKER_START)) continue;
      const nextContent = stripManagedBlock(currentContent);
      const finalContent = nextContent ? `${nextContent}\n` : '';
      changed = writeTextFileIfChanged(profilePath, finalContent) || changed;
    }
  }

  // macOS：用 launchctl 写入全局环境变量，新开终端/进程即生效
  if (runtime === 'darwin') {
    applyLaunchctlEnvironment(previousState.values || {}, nextValues, execSync);
    const prevValues = previousState.values || {};
    const keysChanged =
      Object.keys(nextValues).length !== Object.keys(prevValues).length ||
      Object.entries(nextValues).some(([k, v]) => prevValues[k] !== v);
    changed = changed || keysChanged;
  }

  // Linux：写 ~/.config/environment.d/（桌面/systemd）+ ~/.profile（SSH/登录shell）
  if (runtime === 'linux') {
    changed = applyLinuxEnvironment(nextValues, homeDir) || changed;
  }

  if (nextKeys.length > 0) {
    writeJsonFile(stateFilePath, {
      version: 1,
      values: nextValues,
      profiles: []
    });
  } else if (fs.existsSync(stateFilePath)) {
    fs.unlinkSync(stateFilePath);
  }

  return {
    changed,
    reloadRequired: changed,
    isFirstTime: Object.keys(previousState.values || {}).length === 0 && nextKeys.length > 0,
    sourceCommand: null,
    shellConfigPath: null,
    shellConfigPaths: [],
    envFilePath: null,
    managedKeys: nextKeys
  };
}

function applyLinuxEnvironment(nextValues, homeDir) {
  let changed = false;

  // 1. ~/.config/environment.d/codex-env.conf（systemd 用户环境，桌面终端生效）
  const envdDir = path.join(homeDir, '.config', 'environment.d');
  const envdFile = path.join(envdDir, 'codex-env.conf');
  const nextKeys = Object.keys(nextValues).sort();

  if (nextKeys.length > 0) {
    const envdContent = [
      '# Managed by Coding-Tool',
      ...nextKeys.map(key => `${key}=${nextValues[key]}`),
      ''
    ].join('\n');
    changed = writeTextFileIfChanged(envdFile, envdContent) || changed;
  } else if (fs.existsSync(envdFile)) {
    fs.unlinkSync(envdFile);
    changed = true;
  }

  // 2. ~/.profile（登录 shell，SSH 和新终端均生效）
  const profilePath = path.join(homeDir, '.profile');
  if (nextKeys.length > 0) {
    const exportLines = nextKeys.map(key => `export ${key}=${shellQuote(nextValues[key])}`).join('\n');
    const snippet = [PROFILE_MARKER_START, exportLines, PROFILE_MARKER_END].join('\n');
    const currentContent = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf8') : '';
    const nextContent = upsertManagedBlock(currentContent, snippet);
    changed = writeTextFileIfChanged(profilePath, nextContent) || changed;
  } else if (fs.existsSync(profilePath)) {
    const currentContent = fs.readFileSync(profilePath, 'utf8');
    if (currentContent.includes(PROFILE_MARKER_START)) {
      const nextContent = stripManagedBlock(currentContent);
      const finalContent = nextContent ? `${nextContent}\n` : '';
      changed = writeTextFileIfChanged(profilePath, finalContent) || changed;
    }
  }

  return changed;
}

function applyLaunchctlEnvironment(previousValues, nextValues, execSync) {
  const previousKeys = new Set(Object.keys(previousValues || {}));
  for (const [key, value] of Object.entries(nextValues || {})) {
    if (previousValues[key] === value) {
      previousKeys.delete(key);
      continue;
    }
    runLaunchctlCommand(['setenv', key, value], execSync);
    previousKeys.delete(key);
  }
  for (const key of previousKeys) {
    runLaunchctlCommand(['unsetenv', key], execSync);
  }
}

function runLaunchctlCommand(args, execSync) {
  try {
    execSync('launchctl', args, {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 3000
    });
  } catch {
    // ignore launchctl failures; shell profile remains the durable source
  }
}

function syncWindowsEnvironment(nextValues, previousState, options) {
  const { stateFilePath, execSync } = options;
  const nextKeys = Object.keys(nextValues).sort();
  const previousValues = previousState.values || {};
  let changed = false;

  for (const [key, value] of Object.entries(nextValues)) {
    if (previousValues[key] === value) continue;
    setWindowsUserEnv(key, value, execSync);
    changed = true;
  }

  for (const key of Object.keys(previousValues)) {
    if (Object.prototype.hasOwnProperty.call(nextValues, key)) continue;
    removeWindowsUserEnv(key, execSync);
    changed = true;
  }

  if (nextKeys.length > 0) {
    writeJsonFile(stateFilePath, {
      version: 1,
      values: nextValues,
      profiles: []
    });
  } else if (fs.existsSync(stateFilePath)) {
    fs.unlinkSync(stateFilePath);
  }

  return {
    changed,
    reloadRequired: changed,
    isFirstTime: Object.keys(previousValues).length === 0 && nextKeys.length > 0,
    sourceCommand: null,
    shellConfigPath: null,
    shellConfigPaths: [],
    envFilePath: null,
    managedKeys: nextKeys
  };
}

function runWindowsEnvCommand(script, execSync) {
  const candidates = ['powershell', 'pwsh'];
  let lastError = null;
  for (const command of candidates) {
    try {
      execSync(command, ['-NoProfile', '-NonInteractive', '-Command', script], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 5000
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No PowerShell executable available');
}

function setWindowsUserEnv(key, value, execSync) {
  runWindowsEnvCommand(
    `[Environment]::SetEnvironmentVariable(${powershellQuote(key)}, ${powershellQuote(value)}, 'User')`,
    execSync
  );
}

function removeWindowsUserEnv(key, execSync) {
  runWindowsEnvCommand(
    `[Environment]::SetEnvironmentVariable(${powershellQuote(key)}, $null, 'User')`,
    execSync
  );
}

function syncCodexUserEnvironment(envMap = {}, options = {}) {
  const configDir = options.configDir || PATHS.config;
  const homeDir = options.homeDir || HOME_DIR;
  const envFilePath = options.envFilePath || defaultEnvFilePath(configDir);
  const stateFilePath = options.stateFilePath || defaultStateFilePath(configDir);
  const runtime = options.runtime || process.platform;
  const shellEnv = options.shellEnv || process.env;
  const execSync = options.execFileSync || execFileSync;
  const previousState = readState(stateFilePath);
  const nextValues = buildNextEnvValues(previousState.values, envMap, {
    replace: options.replace !== false,
    removeKeys: options.removeKeys || []
  });

  const syncOptions = {
    runtime,
    homeDir,
    envFilePath,
    stateFilePath,
    shellEnv,
    execSync
  };

  if (runtime === 'win32') {
    return syncWindowsEnvironment(nextValues, previousState, syncOptions);
  }

  return syncPosixEnvironment(nextValues, previousState, syncOptions);
}

module.exports = {
  syncCodexUserEnvironment,
  _test: {
    buildHomeRelativeShellPath,
    buildNextEnvValues,
    buildSourceSnippet,
    getPosixProfileCandidates,
    readState,
    shellQuote,
    stripManagedBlock,
    syncCodexUserEnvironment,
    upsertManagedBlock
  }
};
