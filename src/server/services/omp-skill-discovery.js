const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getOmpCommand,
  getOmpPaths,
  readOmpSettings
} = require('./omp-config');
const { HOME_DIR, NATIVE_PATHS } = require('../../config/paths');

const DEFAULT_SKILL_SETTINGS = Object.freeze({
  enabled: true,
  enableCodexUser: true,
  enableClaudeUser: true,
  enableClaudeProject: true,
  enablePiUser: true,
  enablePiProject: true,
  enableAgentsUser: true,
  enableAgentsProject: true,
  customDirectories: [],
  ignoredSkills: [],
  includeSkills: [],
  disabledExtensions: []
});

function expandHome(value) {
  const input = String(value || '').trim();
  if (input === '~') return HOME_DIR;
  if (input.startsWith('~/')) return path.join(HOME_DIR, input.slice(2));
  return input;
}

function readEffectiveSettings(cwd) {
  try {
    const output = execFileSync(getOmpCommand(), ['config', 'list', '--json'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true
    });
    const parsed = JSON.parse(String(output || '').trim());
    const flattened = {};
    for (const [key, item] of Object.entries(parsed || {})) {
      if (key.startsWith('skills.')) {
        flattened[key.slice('skills.'.length)] = item?.value;
      } else if (key === 'disabledExtensions' || key === 'disabledProviders') {
        flattened[key] = item?.value;
      }
    }
    return { ...DEFAULT_SKILL_SETTINGS, ...flattened };
  } catch {
    const persisted = readOmpSettings();
    return {
      ...DEFAULT_SKILL_SETTINGS,
      ...(persisted.skills && typeof persisted.skills === 'object' ? persisted.skills : {}),
      disabledExtensions: persisted.disabledExtensions || [],
      disabledProviders: persisted.disabledProviders || []
    };
  }
}

function globMatches(value, pattern) {
  const escaped = String(pattern || '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function isIncluded(name, settings) {
  const disabled = Array.isArray(settings.disabledExtensions)
    ? settings.disabledExtensions
    : [];
  if (disabled.some(item => item === `skill:${name}`)) return false;

  const ignored = Array.isArray(settings.ignoredSkills) ? settings.ignoredSkills : [];
  if (ignored.some(pattern => globMatches(name, pattern))) return false;

  const included = Array.isArray(settings.includeSkills) ? settings.includeSkills : [];
  return included.length === 0 || included.some(pattern => globMatches(name, pattern));
}

function parseSkill(service, skillFile, provider, scope, requireDescription) {
  let metadata;
  try {
    metadata = service.parseSkillMd(fs.readFileSync(skillFile, 'utf8'));
  } catch {
    return null;
  }

  const directory = path.basename(path.dirname(skillFile));
  const name = String(metadata.name || directory).trim();
  const description = String(metadata.description || '').trim();
  if (!name || (requireDescription && !description)) return null;

  let realPath = skillFile;
  try {
    realPath = fs.realpathSync(skillFile);
  } catch {
    // Keep the absolute source path when a realpath cannot be resolved.
  }

  const native = provider === 'native';
  return {
    key: `omp:${provider}:${scope}:${realPath}`,
    name,
    description,
    directory,
    installed: true,
    isLocal: false,
    source: native ? 'native-installed' : 'provider-installed',
    sourceProvider: provider,
    sourceScope: scope,
    sourcePath: skillFile,
    realPath,
    readonly: !native,
    shadowedSources: [],
    protected: false,
    readmeUrl: null,
    repoOwner: null,
    repoName: null,
    repoBranch: null,
    license: metadata.license || null
  };
}

function scanOneLevel(service, root, descriptor, settings) {
  if (!root || !fs.existsSync(root)) return [];
  const result = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (!entry.isDirectory()) {
      if (!entry.isSymbolicLink()) continue;
      try {
        if (!fs.statSync(entryPath).isDirectory()) continue;
      } catch {
        continue;
      }
    }
    const skillFile = path.join(entryPath, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const skill = parseSkill(
      service,
      skillFile,
      descriptor.provider,
      descriptor.scope,
      descriptor.requireDescription
    );
    if (skill && isIncluded(skill.name, settings)) {
      result.push(skill);
    }
  }
  return result;
}

function getPluginInstallPaths(cwd) {
  try {
    const output = execFileSync(getOmpCommand(), ['plugin', 'list', '--json'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true
    });
    const parsed = JSON.parse(String(output || '').trim());
    const paths = [];
    const visit = (value, inheritedScope = 'user') => {
      if (Array.isArray(value)) {
        value.forEach(item => visit(item, inheritedScope));
        return;
      }
      if (!value || typeof value !== 'object') return;
      const scope = value.scope || inheritedScope;
      if (value.installPath || value.path) {
        paths.push({
          path: value.installPath || value.path,
          scope
        });
      }
      for (const nested of Object.values(value)) {
        if (nested && typeof nested === 'object') visit(nested, scope);
      }
    };
    visit(parsed);
    return paths;
  } catch {
    return [];
  }
}

function getClaudePluginSkillRoots() {
  const pluginsDir = NATIVE_PATHS.claude.plugins
    || path.join(NATIVE_PATHS.claude.dir, 'plugins');
  const installedFile = path.join(pluginsDir, 'installed_plugins.json');
  if (!fs.existsSync(installedFile)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(installedFile, 'utf8'));
    const roots = [];
    for (const installations of Object.values(parsed?.plugins || {})) {
      if (!Array.isArray(installations)) continue;
      for (const installation of installations) {
        const installPath = String(installation?.installPath || '').trim();
        if (!installPath) continue;
        roots.push({
          path: path.join(installPath, 'skills'),
          scope: installation.scope === 'project' ? 'project' : 'user'
        });
      }
    }
    return roots;
  } catch {
    return [];
  }
}

function providerEnabled(settings, provider, scope) {
  if (Array.isArray(settings.disabledProviders) && settings.disabledProviders.includes(provider)) {
    return false;
  }
  if (provider === 'native') {
    return scope === 'project' ? settings.enablePiProject !== false : settings.enablePiUser !== false;
  }
  if (provider === 'omp-plugins') {
    return scope === 'project' ? settings.enablePiProject !== false : settings.enablePiUser !== false;
  }
  if (provider === 'claude') {
    return scope === 'project' ? settings.enableClaudeProject !== false : settings.enableClaudeUser !== false;
  }
  if (provider === 'claude-plugins') {
    return scope === 'project'
      ? settings.enableClaudeProject !== false
      : settings.enableClaudeUser !== false;
  }
  if (provider === 'agents') {
    return scope === 'project' ? settings.enableAgentsProject !== false : settings.enableAgentsUser !== false;
  }
  if (provider === 'codex' && scope === 'user') {
    return settings.enableCodexUser !== false;
  }
  return [
    settings.enablePiUser,
    settings.enablePiProject,
    settings.enableClaudeUser,
    settings.enableClaudeProject,
    settings.enableCodexUser,
    settings.enableAgentsUser,
    settings.enableAgentsProject
  ].some(value => value !== false);
}

function compactShadow(skill) {
  return {
    sourceProvider: skill.sourceProvider,
    sourceScope: skill.sourceScope,
    sourcePath: skill.sourcePath
  };
}

function deduplicateDiscoveredSkills(skills) {
  const byName = new Map();
  const byRealPath = new Map();
  const result = [];

  for (const skill of skills) {
    const nameKey = skill.name.toLowerCase();
    const pathKey = skill.realPath || skill.sourcePath;
    const existing = byName.get(nameKey) || byRealPath.get(pathKey);
    if (existing) {
      existing.shadowedSources.push(compactShadow(skill));
      continue;
    }
    byName.set(nameKey, skill);
    byRealPath.set(pathKey, skill);
    result.push(skill);
  }

  return result;
}

function discoverOmpSkills(service, options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : null;
  const settings = readEffectiveSettings(cwd);
  if (settings.enabled === false) return [];

  const ompPaths = getOmpPaths();
  const userHome = HOME_DIR;
  const descriptors = [
    { provider: 'native', scope: 'user', root: ompPaths.skills, requireDescription: true },
    ...(cwd ? [{ provider: 'native', scope: 'project', root: path.join(cwd, '.omp', 'skills'), requireDescription: true }] : []),
    ...getPluginInstallPaths(cwd)
      .filter(item => cwd || item.scope !== 'project')
      .map(item => ({
        provider: 'omp-plugins',
        scope: item.scope || 'user',
        root: path.join(item.path, 'skills'),
        requireDescription: true
      })),
    { provider: 'claude', scope: 'user', root: NATIVE_PATHS.claude.skills, requireDescription: false },
    ...(cwd ? [{ provider: 'claude', scope: 'project', root: path.join(cwd, '.claude', 'skills'), requireDescription: false }] : []),
    ...getClaudePluginSkillRoots()
      .filter(item => cwd || item.scope !== 'project')
      .map(item => ({
        provider: 'claude-plugins',
        scope: item.scope,
        root: item.path,
        requireDescription: false
      })),
    { provider: 'agents', scope: 'user', root: path.join(userHome, '.agents', 'skills'), requireDescription: false },
    { provider: 'agents', scope: 'user', root: path.join(userHome, '.agent', 'skills'), requireDescription: false },
    ...(cwd ? [
      { provider: 'agents', scope: 'project', root: path.join(cwd, '.agents', 'skills'), requireDescription: false },
      { provider: 'agents', scope: 'project', root: path.join(cwd, '.agent', 'skills'), requireDescription: false }
    ] : []),
    { provider: 'codex', scope: 'user', root: path.join(userHome, '.codex', 'skills'), requireDescription: false },
    ...(cwd ? [{ provider: 'codex', scope: 'project', root: path.join(cwd, '.codex', 'skills'), requireDescription: false }] : []),
    { provider: 'opencode', scope: 'user', root: path.join(NATIVE_PATHS.opencode.config, 'skills'), requireDescription: false },
    ...(cwd ? [{ provider: 'opencode', scope: 'project', root: path.join(cwd, '.opencode', 'skills'), requireDescription: false }] : [])
  ];

  const discovered = [];
  for (const descriptor of descriptors) {
    if (!providerEnabled(settings, descriptor.provider, descriptor.scope)) continue;
    discovered.push(...scanOneLevel(service, descriptor.root, descriptor, settings));
  }

  const customDirectories = Array.isArray(settings.customDirectories)
    ? settings.customDirectories
    : [];
  for (const customDirectory of customDirectories) {
    const expanded = expandHome(customDirectory);
    const root = path.isAbsolute(expanded)
      ? expanded
      : path.resolve(cwd || process.cwd(), expanded);
    discovered.push(...scanOneLevel(service, root, {
      provider: 'custom',
      scope: cwd && root.startsWith(`${cwd}${path.sep}`) ? 'project' : 'user',
      requireDescription: true
    }, settings));
  }

  return deduplicateDiscoveredSkills(discovered);
}

module.exports = {
  DEFAULT_SKILL_SETTINGS,
  discoverOmpSkills,
  deduplicateDiscoveredSkills,
  readEffectiveSettings
};
