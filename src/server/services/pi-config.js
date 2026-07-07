const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { HOME_DIR } = require('../../config/paths');

const DEFAULT_OMP_COMMAND = 'omp';
const LEGACY_PI_COMMAND = 'pi';

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
  if (env.OMP_PROFILE !== undefined) {
    return normalizeProfileName(env.OMP_PROFILE);
  }
  return normalizeProfileName(env.PI_PROFILE);
}

function isAbsolutePathLike(value = '') {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || String(value).startsWith('\\\\');
}

function getOmpConfigRoot(env = process.env) {
  const configured = expandHome(env.PI_CONFIG_DIR || '');
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

function getLegacyPiAgentDir() {
  return path.join(HOME_DIR, '.pi', 'agent');
}

function getFallbackPiAgentDir(runtime, env = process.env) {
  const configured = expandHome(env.PI_CODING_AGENT_DIR || '');
  if (configured) return configured;
  return runtime?.runtime === 'pi' ? getLegacyPiAgentDir(env) : getDefaultOmpAgentDir(env);
}

function buildCommandEnv(env = process.env) {
  return {
    ...process.env,
    ...env
  };
}

function runPiCommand(command, args = [], env = process.env, options = {}, stdio = ['ignore', 'pipe', 'pipe']) {
  const runner = options.commandRunner || execFileSync;
  return runner(command, args, {
    encoding: 'utf8',
    env: buildCommandEnv(env),
    stdio,
    timeout: options.timeout || 3000
  });
}

function readOmpAgentDirFromCommand(command, env = process.env, options = {}) {
  try {
    const output = runPiCommand(command, ['config', 'path'], env, options);
    const agentDir = String(output || '').trim().split(/\r?\n/).find(Boolean);
    return agentDir ? path.resolve(expandHome(agentDir)) : '';
  } catch {
    return '';
  }
}

function getPiAgentDir(env = process.env, options = {}) {
  const runtime = options.runtime || resolvePiRuntime(env, options);
  if (runtime.runtime === 'omp' && runtime.installed) {
    const commandAgentDir = readOmpAgentDirFromCommand(runtime.command, env, options);
    if (commandAgentDir) {
      return commandAgentDir;
    }
  }
  return path.resolve(expandHome(getFallbackPiAgentDir(runtime, env)));
}

function getPiPaths(env = process.env, options = {}) {
  const runtime = options.runtime || resolvePiRuntime(env, options);
  const agentDir = getPiAgentDir(env, { ...options, runtime });
  return {
    agentDir,
    config: path.join(agentDir, 'config.yml'),
    settings: path.join(agentDir, 'config.yml'),
    settingsJsonLegacy: path.join(agentDir, 'settings.json'),
    auth: path.join(agentDir, 'auth.json'),
    models: path.join(agentDir, 'models.yml'),
    modelsYml: path.join(agentDir, 'models.yml'),
    modelsJsonLegacy: path.join(agentDir, 'models.json'),
    sessions: path.join(agentDir, 'sessions'),
    skills: path.join(agentDir, 'skills'),
    prompts: path.join(agentDir, 'prompts'),
    commands: path.join(agentDir, 'commands'),
    notes: path.join(agentDir, 'notes'),
    extensions: path.join(agentDir, 'extensions'),
    themes: path.join(agentDir, 'themes'),
    packages: path.join(agentDir, 'packages'),
    managedProviderExtension: path.join(agentDir, 'extensions', 'coding-tool-x-provider.ts')
  };
}

function ensurePiDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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
  ensurePiDir(path.dirname(filePath));
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
  ensurePiDir(path.dirname(filePath));
  fs.writeFileSync(filePath, yaml.dump(data || {}, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  }), 'utf8');
}

function readPiSettings() {
  const paths = getPiPaths();
  return readYamlFile(paths.settings, readJsonFile(paths.settingsJsonLegacy, {}));
}

function writePiSettings(settings) {
  writeYamlFile(getPiPaths().settings, settings || {});
}

function getPiCommand(env = process.env) {
  return String(env.OMP_COMMAND || env.PI_COMMAND || DEFAULT_OMP_COMMAND).trim() || DEFAULT_OMP_COMMAND;
}

function commandExists(command, env = process.env, options = {}) {
  try {
    runPiCommand(command, ['--version'], env, options, 'ignore');
    return true;
  } catch {
    return false;
  }
}

function resolvePiRuntime(env = process.env, options = {}) {
  const configured = env.OMP_COMMAND || env.PI_COMMAND;
  if (configured) {
    const command = getPiCommand(env);
    const source = env.OMP_COMMAND ? 'OMP_COMMAND' : 'PI_COMMAND';
    return {
      command,
      runtime: command === LEGACY_PI_COMMAND ? 'pi' : 'omp',
      installed: commandExists(command, env, options),
      configured: true,
      commandSource: source
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

  if (commandExists(LEGACY_PI_COMMAND, env, options)) {
    return {
      command: LEGACY_PI_COMMAND,
      runtime: 'pi',
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

function isPiInstalled(env = process.env, options = {}) {
  const runtime = options.runtime || resolvePiRuntime(env, options);
  if (runtime.installed) {
    return true;
  }
  return fs.existsSync(getPiPaths(env, { ...options, runtime }).agentDir);
}

function readTextFile(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function getPiStatus(env = process.env, options = {}) {
  const runtime = resolvePiRuntime(env, options);
  const paths = getPiPaths(env, { ...options, runtime });
  return {
    installed: isPiInstalled(env, { ...options, runtime }),
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
  getPiAgentDir,
  getPiPaths,
  ensurePiDir,
  readJsonFile,
  readYamlFile,
  readTextFile,
  writeJsonFile,
  writeYamlFile,
  readPiSettings,
  writePiSettings,
  getPiCommand,
  getOmpProfile,
  resolvePiRuntime,
  isPiInstalled,
  getPiStatus
};
