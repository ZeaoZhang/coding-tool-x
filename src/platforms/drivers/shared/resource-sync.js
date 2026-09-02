'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('@iarna/toml');
const tomlStringify = require('@iarna/toml').stringify;
const { ok, failed } = require('../../../shared/driver-result');
const { assertNoSymlinkComponents } = require('../../../shared/project-config');

const CONFIG_TYPES = {
  skills: {
    isDirectory: true,
    markerFile: 'SKILL.md',
    claudeTarget: 'skills',
    codexTarget: 'skills',
    codexSupported: true,
    geminiTarget: 'skills',
    geminiSupported: true,
    opencodeTarget: 'skills',
    opencodeLegacyTarget: 'skill',
    opencodeSupported: true,
    ompTarget: 'skills',
    ompSupported: true
  },
  commands: {
    isDirectory: false,
    extension: '.md',
    claudeTarget: 'commands',
    codexTarget: 'prompts',
    codexSupported: true,
    geminiTarget: 'commands',
    geminiExtension: '.toml',
    geminiSupported: true,
    opencodeTarget: 'commands',
    opencodeLegacyTarget: 'command',
    opencodeSupported: true,
    ompTarget: 'commands',
    ompSupported: true
  },
  agents: {
    isDirectory: false,
    extension: '.md',
    claudeTarget: 'agents',
    codexSupported: true,
    geminiTarget: 'agents',
    geminiSupported: true,
    opencodeTarget: 'agents',
    opencodeLegacyTarget: 'agent',
    opencodeSupported: true,
    ompSupported: false
  },
  plugins: {
    isDirectory: true,
    claudeTarget: 'plugins',
    codexSupported: false,
    geminiSupported: false,
    opencodeTarget: 'plugins',
    opencodeLegacyTarget: 'plugin',
    opencodeSupported: true,
    ompTarget: 'extensions',
    ompSupported: true
  }
};

function normalizeSafeRelativeName(name) {
  const raw = String(name || '').replace(/\\/g, '/').trim();
  if (!raw || raw.includes('\0') || path.isAbsolute(raw) || raw.startsWith('/')) return null;
  const normalized = path.posix.normalize(raw).replace(/^(\.\/)+/, '');
  return normalized && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../') ? normalized : null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(source, target);
    else fs.copyFileSync(source, target);
  }
}

function copyDirWithConversion(src, dest, transform) {
  ensureDir(dest);
  const textExtensions = new Set(['.md', '.txt', '.json', '.js', '.ts', '.py', '.sh', '.yaml', '.yml']);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirWithConversion(source, target, transform);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) {
      fs.copyFileSync(source, target);
      continue;
    }
    fs.writeFileSync(target, transform(source, fs.readFileSync(source, 'utf8')), 'utf8');
  }
}

function removeRecursive(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function cleanupEmptyParents(dir, baseDir) {
  const normalizedDir = path.resolve(dir);
  const normalizedBase = path.resolve(baseDir);
  if (!normalizedDir.startsWith(`${normalizedBase}${path.sep}`)) return;
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      cleanupEmptyParents(path.dirname(dir), baseDir);
    }
  } catch (_) {
    // The target may have disappeared concurrently.
  }
}

function parseFrontmatter(content) {
  const result = { frontmatter: {}, body: content };
  const normalized = content.trim().replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return result;
  result.body = match[2].trim();
  for (const line of match[1].split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result.frontmatter[key] = value;
  }
  return result;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createResourceSyncDriver({ platform, configTypes = CONFIG_TYPES, resourcePaths = {}, ...context } = {}) {
  const { PATHS, NATIVE_PATHS, HOME_DIR } = require('../../../config/paths');
  const home = HOME_DIR || os.homedir();
  const native = NATIVE_PATHS || {};
  const codexConfigPath = native.codex.config;
  const config = {
    home,
    configs: PATHS.configs,
    skillArtifacts: PATHS.skillArtifacts,
    claudeDir: native.claude?.dir || path.dirname(native.claude?.settings || '') || path.join(home, '.claude'),
    codexDir: path.dirname(codexConfigPath),
    geminiDir: path.join(home, '.gemini'),
    opencodeDir: native.opencode?.config,
    ompDir: native.omp?.dir || path.join(home, '.omp', 'agent'),
    codexConfigPath,
    ...resourcePaths
  };

  const getType = type => configTypes[type];
  const isSupported = typeConfig => typeConfig && typeConfig[`${platform}Supported`] !== false;
  const resolveSourcePath = (type, safeName, sourcePathOverride) => {
    const sourcePath = sourcePathOverride ? path.resolve(sourcePathOverride) : path.join(config.configs, type, safeName);
    const allowedRoots = [path.join(config.configs, type), config.skillArtifacts]
      .filter(Boolean)
      .map(root => path.resolve(root));
    const allowedRoot = allowedRoots.find(root => sourcePath === root || sourcePath.startsWith(`${root}${path.sep}`));
    if (!allowedRoot) throw new Error('Controlled source path escapes allowed storage');
    assertNoSymlinkComponents(allowedRoot, sourcePath, fs);
    if (sourcePathOverride && !fs.existsSync(sourcePath)) throw new Error('Controlled source path not found');
    return sourcePath;
  };
  const readCodexConfig = () => fs.existsSync(config.codexConfigPath) ? toml.parse(fs.readFileSync(config.codexConfigPath, 'utf8')) : {};
  const writeCodexConfig = value => {
    ensureDir(path.dirname(config.codexConfigPath));
    const tempPath = `${config.codexConfigPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, tomlStringify(value), 'utf8');
    fs.renameSync(tempPath, config.codexConfigPath);
  };
  const resolveCodexPath = value => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return '';
    if (normalized.startsWith('~/')) return path.join(config.home, normalized.slice(2));
    return path.isAbsolute(normalized) ? normalized : path.resolve(path.dirname(config.codexConfigPath), normalized);
  };
  const managedCodexDir = () => path.join(config.codexDir, 'agents');
  const managedCodexPath = name => path.join(managedCodexDir(), `${name}.toml`);
  const isManagedCodexPath = value => {
    const resolved = resolveCodexPath(value);
    if (!resolved) return false;
    const root = path.resolve(managedCodexDir());
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  };
  const readCodexAgentConfig = value => {
    const resolved = resolveCodexPath(value);
    if (!resolved || !fs.existsSync(resolved)) return null;
    const content = fs.readFileSync(resolved, 'utf8');
    try { return { content, data: toml.parse(content) }; } catch (_) { return { content, data: null }; }
  };
  const writeCodexAgentConfig = (value, data) => {
    const resolved = resolveCodexPath(value);
    ensureDir(path.dirname(resolved));
    const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, tomlStringify(data), 'utf8');
    fs.renameSync(tempPath, resolved);
  };
  const converter = () => require('../../../server/services/format-converter');
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function targetBasePath(type, typeConfig) {
    if (platform === 'claude') return path.join(config.claudeDir, typeConfig.claudeTarget);
    if (platform === 'codex') return path.join(config.codexDir, typeConfig.codexTarget);
    if (platform === 'gemini') return path.join(config.geminiDir, typeConfig.geminiTarget);
    if (platform === 'opencode') {
      const modern = path.join(config.opencodeDir, typeConfig.opencodeTarget);
      if (type === 'skills' || !typeConfig.opencodeLegacyTarget) return modern;
      const legacy = path.join(config.opencodeDir, typeConfig.opencodeLegacyTarget);
      return fs.existsSync(legacy) && !fs.existsSync(modern) ? legacy : modern;
    }
    return path.join(config.ompDir, typeConfig.ompTarget);
  }

  function targetPath(type, safeName) {
    const typeConfig = getType(type);
    if (platform === 'gemini' && typeConfig.geminiExtension) {
      const extension = path.extname(safeName);
      const targetName = safeName.replace(new RegExp(`${escapeRegExp(extension)}$`, 'i'), typeConfig.geminiExtension);
      return path.join(targetBasePath(type, typeConfig), targetName);
    }
    return path.join(targetBasePath(type, typeConfig), safeName);
  }

  function syncCodex(type, safeName, sourcePath) {
    const warnings = [];
    if (type === 'agents') {
      const { frontmatter } = parseFrontmatter(fs.readFileSync(sourcePath, 'utf8'));
      const fileName = path.basename(safeName, path.extname(safeName));
      const codexConfig = readCodexConfig();
      codexConfig.features = isPlainObject(codexConfig.features) ? codexConfig.features : {};
      codexConfig.features.multi_agent = true;
      codexConfig.agents = isPlainObject(codexConfig.agents) ? codexConfig.agents : {};
      const existing = codexConfig.agents[fileName];
      if (Object.prototype.hasOwnProperty.call(codexConfig.agents, fileName) && !isPlainObject(existing)) {
        return { success: false, error: `Agent name "${fileName}" conflicts with global [agents] key` };
      }
      const entry = isPlainObject(existing) ? { ...existing } : {};
      entry.description = (frontmatter.description || fileName).trim();
      const model = typeof frontmatter.model === 'string' ? frontmatter.model.trim() : '';
      const existingConfigFile = typeof entry.config_file === 'string' ? entry.config_file.trim() : '';
      if (model) {
        const managedPath = isManagedCodexPath(existingConfigFile) ? existingConfigFile : managedCodexPath(fileName);
        const parsed = readCodexAgentConfig(managedPath);
        const data = isPlainObject(parsed?.data) ? parsed.data : {};
        data.model = model;
        writeCodexAgentConfig(managedPath, data);
        entry.config_file = managedPath;
      } else if (isManagedCodexPath(existingConfigFile)) {
        const resolved = resolveCodexPath(existingConfigFile);
        if (resolved && fs.existsSync(resolved)) fs.unlinkSync(resolved);
        delete entry.config_file;
      }
      codexConfig.agents[fileName] = entry;
      writeCodexConfig(codexConfig);
      return { success: true, target: config.codexConfigPath, warnings };
    }
    if (type === 'skills') {
      const target = targetPath(type, safeName);
      copyDirWithConversion(sourcePath, target, (filePath, content) => {
        if (path.basename(filePath) !== 'SKILL.md') return content;
        const result = converter().convertSkillToCodex(content);
        warnings.push(...(result.warnings || []));
        return result.content;
      });
      return { success: true, target, warnings };
    }
    if (type === 'commands') {
      const result = converter().convertCommandToCodex(fs.readFileSync(sourcePath, 'utf8'));
      warnings.push(...(result.warnings || []));
      const target = targetPath(type, safeName);
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, result.content, 'utf8');
      return { success: true, target, warnings };
    }
    return { success: false, error: 'Unexpected type' };
  }

  function sync(type, name, sourcePathOverride = null) {
    const typeConfig = getType(type);
    if (!typeConfig) return { success: false, error: `Unknown config type: ${type}` };
    if (!isSupported(typeConfig)) {
      const reason = platform === 'omp' ? 'Not supported natively by OMP' : `Not supported by ${platform}`;
      return { success: true, skipped: true, reason };
    }
    const safeName = normalizeSafeRelativeName(name);
    if (!safeName) return { success: false, error: 'Invalid config item name' };
    const sourcePath = resolveSourcePath(type, safeName, sourcePathOverride);
    if (!fs.existsSync(sourcePath)) return { success: false, error: 'Source not found' };
    if (platform === 'codex') return syncCodex(type, safeName, sourcePath);
    const target = targetPath(type, safeName);
    ensureDir(path.dirname(target));
    if (typeConfig.isDirectory) copyDirRecursive(sourcePath, target);
    else if (platform === 'gemini' && type === 'commands') {
      const result = converter().convertCommandToGemini(fs.readFileSync(sourcePath, 'utf8'));
      fs.writeFileSync(target, result.content, 'utf8');
      return { success: true, target, warnings: result.warnings || [] };
    } else fs.copyFileSync(sourcePath, target);
    return { success: true, target };
  }

  function remove(type, name) {
    const typeConfig = getType(type);
    if (!typeConfig) return { success: false, error: `Unknown config type: ${type}` };
    if (!isSupported(typeConfig)) {
      const reason = platform === 'omp' ? 'Not supported natively by OMP' : `Not supported by ${platform}`;
      return { success: true, skipped: true, reason };
    }
    const safeName = normalizeSafeRelativeName(name);
    if (!safeName) return { success: false, error: 'Invalid config item name' };
    if (platform === 'codex' && type === 'agents') {
      const codexConfig = readCodexConfig();
      const agents = isPlainObject(codexConfig.agents) ? codexConfig.agents : {};
      const fileName = path.basename(safeName, path.extname(safeName));
      const existing = agents[fileName];
      if (!isPlainObject(existing)) return { success: true, message: 'Already removed' };
      if (existing.config_file && isManagedCodexPath(existing.config_file)) {
        const resolved = resolveCodexPath(existing.config_file);
        if (resolved && fs.existsSync(resolved)) fs.unlinkSync(resolved);
      }
      delete agents[fileName];
      codexConfig.agents = agents;
      writeCodexConfig(codexConfig);
      return { success: true };
    }
    const target = targetPath(type, safeName);
    if (!fs.existsSync(target)) return { success: true, message: 'Already removed' };
    if (typeConfig.isDirectory) removeRecursive(target);
    else {
      fs.unlinkSync(target);
      cleanupEmptyParents(path.dirname(target), targetBasePath(type, typeConfig));
    }
    return { success: true };
  }

  const invoke = (operation, args) => {
    try {
      const value = operation === 'sync' ? sync(...args) : remove(...args);
      const wrap = data => ok(platform, 'resourceSync', operation, data);
      return value && typeof value.then === 'function' ? value.then(wrap).catch(error => failed(platform, 'resourceSync', operation, error)) : wrap(value);
    } catch (error) {
      return failed(platform, 'resourceSync', operation, error);
    }
  };

  return { platform, capability: 'resourceSync', ...context, sync: (...args) => invoke('sync', args), remove: (...args) => invoke('remove', args) };
}

module.exports = { CONFIG_TYPES, createResourceSyncDriver, normalizeSafeRelativeName };
