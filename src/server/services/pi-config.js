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

function getDefaultOmpAgentDir(env = process.env) {
  const configRoot = expandHome(env.PI_CONFIG_DIR || path.join(HOME_DIR, '.omp'));
  const profile = getOmpProfile(env);
  return profile
    ? path.join(configRoot, 'profiles', profile, 'agent')
    : path.join(configRoot, 'agent');
}

function getPiAgentDir(env = process.env) {
  return path.resolve(expandHome(env.PI_CODING_AGENT_DIR || getDefaultOmpAgentDir(env)));
}

function getPiPaths(env = process.env) {
  const agentDir = getPiAgentDir(env);
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

function commandExists(command) {
  try {
    execFileSync(command, ['--version'], {
      stdio: 'ignore',
      timeout: 3000
    });
    return true;
  } catch {
    return false;
  }
}

function resolvePiRuntime(env = process.env) {
  const configured = env.OMP_COMMAND || env.PI_COMMAND;
  if (configured) {
    const command = getPiCommand(env);
    return {
      command,
      runtime: command === LEGACY_PI_COMMAND ? 'pi' : 'omp',
      installed: commandExists(command),
      configured: true
    };
  }

  if (commandExists(DEFAULT_OMP_COMMAND)) {
    return { command: DEFAULT_OMP_COMMAND, runtime: 'omp', installed: true, configured: false };
  }

  if (commandExists(LEGACY_PI_COMMAND)) {
    return { command: LEGACY_PI_COMMAND, runtime: 'pi', installed: true, configured: false };
  }

  return { command: DEFAULT_OMP_COMMAND, runtime: 'omp', installed: false, configured: false };
}

function isPiInstalled() {
  const runtime = resolvePiRuntime();
  if (runtime.installed) {
    return true;
  }
  return fs.existsSync(getPiPaths().agentDir);
}

function readTextFile(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function getPiStatus() {
  const paths = getPiPaths();
  const runtime = resolvePiRuntime();
  return {
    installed: isPiInstalled(),
    runtime: runtime.runtime,
    command: runtime.command,
    agentDir: paths.agentDir,
    settingsPath: paths.settings,
    authPath: paths.auth,
    modelsPath: paths.modelsYml,
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
