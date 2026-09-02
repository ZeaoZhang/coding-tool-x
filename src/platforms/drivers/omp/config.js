const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { HOME_DIR, PATHS = {} } = require('../../../config/paths');

const DEFAULT_OMP_COMMAND = 'omp';
const YAML_DUMP_OPTIONS = Object.freeze({
  lineWidth: 120,
  noRefs: true,
  sortKeys: false
});

function expandHome(input = '') {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value === '~') return HOME_DIR;
  if (value.startsWith('~/')) return path.join(HOME_DIR, value.slice(2));
  return value;
}

function normalizeProfileName(profile = '') {
  const value = String(profile || '').trim();
  if (!value || value === 'default') return '';
  return value;
}

function getOmpProfile(env = process.env) {
  return normalizeProfileName(env.OMP_PROFILE);
}

function isAbsolutePathLike(value = '') {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || String(value).startsWith('\\\\');
}

function getOmpConfigRoot(env = process.env) {
  const configured = expandHome(env.OMP_CONFIG_DIR || '');
  if (!configured) return path.join(HOME_DIR, '.omp');
  return isAbsolutePathLike(configured) ? configured : path.join(HOME_DIR, configured);
}

function getDefaultOmpAgentDir(env = process.env) {
  const configRoot = getOmpConfigRoot(env);
  const profile = getOmpProfile(env);
  return profile
    ? path.join(configRoot, 'profiles', profile, 'agent')
    : path.join(configRoot, 'agent');
}

function getFallbackOmpAgentDir(runtime, env = process.env) {
  const configured = expandHome(
    env.PI_CODING_AGENT_DIR || env.OMP_CODING_AGENT_DIR || ''
  );
  if (configured) return configured;
  return getDefaultOmpAgentDir(env);
}

function buildCommandEnv(env = process.env) {
  return {
    ...process.env,
    ...env
  };
}

function runOmpCommand(command, args = [], env = process.env, options = {}, stdio = ['ignore', 'pipe', 'pipe']) {
  const runner = options.commandRunner || execFileSync;
  return runner(command, args, {
    encoding: 'utf8',
    env: buildCommandEnv(env),
    stdio,
    timeout: options.timeout || 3000,
    // On Windows, an npm/PowerShell command shim can otherwise create a visible
    // console every time we probe OMP or resolve its configuration directory.
    windowsHide: true
  });
}

function readOmpAgentDirFromCommand(command, env = process.env, options = {}) {
  try {
    const output = runOmpCommand(command, ['config', 'path'], env, options);
    const agentDir = String(output || '').trim().split(/\r?\n/).find(Boolean);
    return agentDir ? path.resolve(expandHome(agentDir)) : '';
  } catch {
    return '';
  }
}

function getOmpAgentDir(env = process.env, options = {}) {
  const runtime = options.runtime || (options.resolveRuntime === false ? null : resolveOmpRuntime(env, options));
  if (runtime?.runtime === 'omp' && runtime.installed) {
    const commandAgentDir = readOmpAgentDirFromCommand(runtime.command, env, options);
    if (commandAgentDir) {
      return commandAgentDir;
    }
  }
  return path.resolve(expandHome(getFallbackOmpAgentDir(runtime, env)));
}

function getOmpPaths(env = process.env, options = {}) {
  const runtime = options.runtime || (options.resolveRuntime === false ? null : resolveOmpRuntime(env, options));
  const agentDir = getOmpAgentDir(env, { ...options, runtime });
  return {
    agentDir,
    config: path.join(agentDir, 'config.yml'),
    settings: path.join(agentDir, 'config.yml'),
    settingsJsonLegacy: path.join(agentDir, 'settings.json'),
    auth: path.join(agentDir, 'auth.json'),
    models: path.join(agentDir, 'models.yml'),
    modelsYml: path.join(agentDir, 'models.yml'),
    modelsJsonLegacy: path.join(agentDir, 'models.json'),
    mcp: path.join(agentDir, 'mcp.json'),
    sessions: path.join(agentDir, 'sessions'),
    skills: path.join(agentDir, 'skills'),
    prompts: path.join(agentDir, 'prompts'),
    commands: path.join(agentDir, 'commands'),
    notes: path.join(agentDir, 'notes'),
    extensions: path.join(agentDir, 'extensions'),
    themes: path.join(agentDir, 'themes'),
    packages: path.join(agentDir, 'packages'),
    managedProviderExtension: path.join(agentDir, 'extensions', 'coding-tool-x-provider.ts'),
    managedVisibilityState: path.join(PATHS.storage || path.join(HOME_DIR, '.cc-tool', 'storage'), 'omp-managed-visibility.json')
  };
}

function ensureOmpDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readJsonFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureOmpDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf8');
}

function readYamlFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeYamlFile(filePath, data) {
  ensureOmpDir(path.dirname(filePath));
  fs.writeFileSync(filePath, yaml.dump(data || {}, YAML_DUMP_OPTIONS), 'utf8');
}

function readOmpSettings() {
  const paths = getOmpPaths();
  return readYamlFile(paths.settings, readJsonFile(paths.settingsJsonLegacy, {}));
}

function writeOmpSettings(settings) {
  writeYamlFile(getOmpPaths().settings, settings || {});
}

function readOmpSettingsStrict() {
  const filePath = getOmpPaths().settings;
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }

  const settings = yaml.load(source);
  if (!isPlainObject(settings)) {
    throw new Error('Invalid OMP config');
  }
  return settings;
}

function writeOmpSettingsAtomic(settings) {
  const filePath = getOmpPaths().settings;
  const directory = path.dirname(filePath);
  ensureOmpDir(directory);
  let mode = 0o600;
  try {
    mode = fs.statSync(filePath).mode & 0o777;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  try {
    fs.writeFileSync(temporaryPath, yaml.dump(settings, YAML_DUMP_OPTIONS), {
      encoding: 'utf8',
      flag: 'wx',
      mode
    });
    fs.chmodSync(temporaryPath, mode);
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) {
        fs.unlinkSync(temporaryPath);
      }
    } catch {
      // Preserve the original write, chmod, or rename failure.
    }
    throw error;
  }
}

function getOmpCommand(env = process.env) {
  return String(env.OMP_COMMAND || DEFAULT_OMP_COMMAND).trim() || DEFAULT_OMP_COMMAND;
}

function commandExists(command, env = process.env, options = {}) {
  try {
    runOmpCommand(command, ['--version'], env, options, 'ignore');
    return true;
  } catch {
    return false;
  }
}

function resolveOmpRuntime(env = process.env, options = {}) {
  const configured = env.OMP_COMMAND;
  if (configured) {
    const command = getOmpCommand(env);
    return {
      command,
      runtime: 'omp',
      installed: commandExists(command, env, options),
      configured: true,
      commandSource: 'OMP_COMMAND'
    };
  }

  if (commandExists(DEFAULT_OMP_COMMAND, env, options)) {
    return {
      command: DEFAULT_OMP_COMMAND,
      runtime: 'omp',
      installed: true,
      configured: false,
      commandSource: 'path'
    };
  }

  return {
    command: DEFAULT_OMP_COMMAND,
    runtime: 'omp',
    installed: false,
    configured: false,
    commandSource: 'fallback'
  };
}

function isOmpInstalled(env = process.env, options = {}) {
  const runtime = options.runtime || resolveOmpRuntime(env, options);
  if (runtime.installed) {
    return true;
  }
  return fs.existsSync(getOmpPaths(env, { ...options, runtime }).agentDir);
}

function readTextFile(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function getOmpStatus(env = process.env, options = {}) {
  if (options.resolveRuntime === false) {
    const paths = getOmpPaths(env, options);
    return {
      installed: fs.existsSync(paths.agentDir),
      runtime: 'omp',
      command: getOmpCommand(env),
      commandSource: 'not-probed',
      agentDir: paths.agentDir,
      settingsPath: paths.settings,
      authPath: paths.auth,
      modelsPath: paths.modelsYml,
      modelsYmlPath: paths.modelsYml,
      modelsJsonLegacyPath: paths.modelsJsonLegacy,
      sessionsDir: paths.sessions,
      skillsDir: paths.skills,
      promptsDir: paths.prompts,
      commandsDir: paths.commands,
      extensionsDir: paths.extensions,
      themesDir: paths.themes,
      packagesDir: paths.packages
    };
  }
  const runtime = resolveOmpRuntime(env, options);
  const paths = getOmpPaths(env, { ...options, runtime });
  return {
    installed: isOmpInstalled(env, { ...options, runtime }),
    runtime: runtime.runtime,
    command: runtime.command,
    commandSource: runtime.commandSource,
    agentDir: paths.agentDir,
    settingsPath: paths.settings,
    authPath: paths.auth,
    modelsPath: paths.modelsYml,
    modelsYmlPath: paths.modelsYml,
    modelsJsonLegacyPath: paths.modelsJsonLegacy,
    sessionsDir: paths.sessions,
    skillsDir: paths.skills,
    promptsDir: paths.prompts,
    commandsDir: paths.commands,
    extensionsDir: paths.extensions,
    themesDir: paths.themes,
    packagesDir: paths.packages
  };
}

module.exports = {
  expandHome,
  getOmpAgentDir,
  getOmpPaths,
  ensureOmpDir,
  readJsonFile,
  readYamlFile,
  readTextFile,
  writeJsonFile,
  writeYamlFile,
  readOmpSettings,
  writeOmpSettings,
  readOmpSettingsStrict,
  writeOmpSettingsAtomic,
  getOmpCommand,
  getOmpProfile,
  resolveOmpRuntime,
  isOmpInstalled,
  getOmpStatus
};
