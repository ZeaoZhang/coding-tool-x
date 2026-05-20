const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { HOME_DIR } = require('../../config/paths');

function expandHome(input = '') {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value === '~') return HOME_DIR;
  if (value.startsWith('~/')) return path.join(HOME_DIR, value.slice(2));
  return value;
}

function getPiAgentDir(env = process.env) {
  return path.resolve(expandHome(env.PI_CODING_AGENT_DIR || path.join(HOME_DIR, '.pi', 'agent')));
}

function getPiPaths(env = process.env) {
  const agentDir = getPiAgentDir(env);
  return {
    agentDir,
    settings: path.join(agentDir, 'settings.json'),
    auth: path.join(agentDir, 'auth.json'),
    models: path.join(agentDir, 'models.json'),
    sessions: path.join(agentDir, 'sessions'),
    skills: path.join(agentDir, 'skills'),
    prompts: path.join(agentDir, 'prompts'),
    extensions: path.join(agentDir, 'extensions'),
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

function readPiSettings() {
  return readJsonFile(getPiPaths().settings, {});
}

function writePiSettings(settings) {
  writeJsonFile(getPiPaths().settings, settings || {});
}

function isPiInstalled() {
  try {
    execFileSync('pi', ['--version'], {
      stdio: 'ignore',
      timeout: 3000
    });
    return true;
  } catch {
    return fs.existsSync(getPiPaths().agentDir);
  }
}

function getPiStatus() {
  const paths = getPiPaths();
  return {
    installed: isPiInstalled(),
    agentDir: paths.agentDir,
    settingsPath: paths.settings,
    authPath: paths.auth,
    sessionsDir: paths.sessions,
    skillsDir: paths.skills,
    promptsDir: paths.prompts,
    extensionsDir: paths.extensions
  };
}

module.exports = {
  expandHome,
  getPiAgentDir,
  getPiPaths,
  ensurePiDir,
  readJsonFile,
  writeJsonFile,
  readPiSettings,
  writePiSettings,
  isPiInstalled,
  getPiStatus
};
