// 配置加载和保存
const fs = require('fs');
const path = require('path');
const os = require('os');
const DEFAULT_CONFIG = require('./default');
const { PATHS, NATIVE_PATHS, ensureStorageDirMigrated } = require('./paths');
const { resolvePreferredHomeDir } = require('../utils/home-dir');
const eventBus = require('../plugins/event-bus');

const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());

const LEGACY_CONFIG_FILES = [
  path.join(__dirname, '../../config.json'),
  path.join(HOME_DIR, '.claude', 'config.json')
];

function getConfigFilePath() {
  ensureStorageDirMigrated();
  return PATHS.configFile;
}

/**
 * 展开 ~ 为用户主目录
 */
function expandHome(filepath) {
  if (typeof filepath !== 'string') {
    return filepath;
  }
  if (filepath.startsWith('~')) {
    return path.join(HOME_DIR, filepath.slice(1));
  }
  return filepath;
}

function collapseHome(filepath) {
  if (typeof filepath !== 'string') {
    return filepath;
  }
  if (filepath === HOME_DIR) {
    return '~';
  }
  const prefix = `${HOME_DIR}${path.sep}`;
  if (filepath.startsWith(prefix)) {
    return path.join('~', filepath.slice(prefix.length));
  }
  return filepath;
}

function getNativeClaudeProjectsDir() {
  return NATIVE_PATHS?.claude?.projects || path.join(HOME_DIR, '.claude', 'projects');
}

function hasExplicitProjectsDir(config = {}) {
  return Object.prototype.hasOwnProperty.call(config, 'projectsDir') &&
    typeof config.projectsDir === 'string' &&
    config.projectsDir.trim() !== '';
}

function resolveClaudeProjectsDir(config = {}) {
  if (!hasExplicitProjectsDir(config) || isDefaultProjectsDir(config.projectsDir)) {
    return getNativeClaudeProjectsDir();
  }
  return expandHome(config.projectsDir);
}

function normalizeComparablePath(filepath) {
  if (typeof filepath !== 'string' || !filepath.trim()) {
    return '';
  }
  return path.normalize(expandHome(filepath.trim()));
}

function isDefaultProjectsDir(projectsDir) {
  const normalized = normalizeComparablePath(projectsDir);
  if (!normalized) {
    return true;
  }
  const nativeDefault = normalizeComparablePath(getNativeClaudeProjectsDir());
  const legacyHomeDefault = normalizeComparablePath(path.join(HOME_DIR, '.claude', 'projects'));
  if (normalized === nativeDefault || normalized === legacyHomeDefault) {
    return true;
  }
  const normalizedParts = normalized.replace(/\\/g, '/').split('/').filter(Boolean);
  const last = normalizedParts[normalizedParts.length - 1];
  const previous = normalizedParts[normalizedParts.length - 2];
  return previous === '.claude' && last === 'projects' && !fs.existsSync(normalized);
}

function normalizeConfigForSave(config = {}) {
  const normalized = { ...config };
  if (isDefaultProjectsDir(normalized.projectsDir)) {
    delete normalized.projectsDir;
  } else if (typeof normalized.projectsDir === 'string') {
    normalized.projectsDir = collapseHome(normalized.projectsDir);
  }
  return normalized;
}

function mergePricing(defaultPricing, overrides = {}) {
  const merged = {};
  Object.keys(defaultPricing).forEach((key) => {
    merged[key] = {
      ...defaultPricing[key],
      ...(overrides && overrides[key] ? overrides[key] : {})
    };
    if (!merged[key].mode) {
      merged[key].mode = 'auto';
    }
  });
  return merged;
}

function mergeDefaultModels(defaultModels, overrides = {}) {
  const merged = {};
  Object.keys(defaultModels).forEach((key) => {
    // If user config has this tool type, use it; otherwise use default
    merged[key] = (overrides && overrides[key]) ? overrides[key] : defaultModels[key];
  });
  return merged;
}

function mergeDefaultSpeedTestModels(defaultModels, overrides = {}) {
  return {
    ...defaultModels,
    ...(overrides || {})
  };
}

function readJsonFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

function migrateLegacyConfigIfNeeded(configFilePath) {
  if (fs.existsSync(configFilePath)) return;

  for (const legacyPath of LEGACY_CONFIG_FILES) {
    try {
      if (!legacyPath || legacyPath === configFilePath) continue;
      if (!fs.existsSync(legacyPath)) continue;
      const legacyConfig = readJsonFile(legacyPath);
      const dir = path.dirname(configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(configFilePath, JSON.stringify(legacyConfig, null, 2), 'utf8');
      console.log(`[Config] 已迁移历史配置: ${legacyPath} -> ${configFilePath}`);
      return;
    } catch (error) {
      console.warn(`[Config] 迁移历史配置失败: ${legacyPath}`, error.message);
    }
  }
}

/**
 * 加载配置
 */
function loadConfig() {
  const configFilePath = getConfigFilePath();
  migrateLegacyConfigIfNeeded(configFilePath);

  try {
    if (fs.existsSync(configFilePath)) {
      const userConfig = readJsonFile(configFilePath);
      const config = { ...DEFAULT_CONFIG, ...userConfig };
      config.projectsDir = resolveClaudeProjectsDir(userConfig);

      // 合并 ports 配置
      config.ports = { ...DEFAULT_CONFIG.ports, ...userConfig.ports };
      config.pricing = mergePricing(DEFAULT_CONFIG.pricing, userConfig.pricing);
      config.defaultModels = mergeDefaultModels(DEFAULT_CONFIG.defaultModels, userConfig.defaultModels);
      config.defaultSpeedTestModels = mergeDefaultSpeedTestModels(
        DEFAULT_CONFIG.defaultSpeedTestModels,
        userConfig.defaultSpeedTestModels
      );

      // 确保有 currentProject，使用 defaultProject 作为 currentProject
      if (!config.currentProject && config.defaultProject) {
        config.currentProject = config.defaultProject;
      }

      eventBus.emitSync('config:loaded', { config });
      return config;
    }
  } catch (error) {
    console.error(`加载配置文件失败，使用默认配置: ${configFilePath}`);
  }
  const defaultConfig = {
    ...DEFAULT_CONFIG,
    projectsDir: resolveClaudeProjectsDir(),
    currentProject: DEFAULT_CONFIG.defaultProject
  };
  eventBus.emitSync('config:loaded', { config: defaultConfig });
  return defaultConfig;
}

/**
 * 保存配置
 */
function saveConfig(config) {
  const configFilePath = getConfigFilePath();
  try {
    const dir = path.dirname(configFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const normalizedConfig = normalizeConfigForSave(config);
    fs.writeFileSync(configFilePath, JSON.stringify(normalizedConfig, null, 2), 'utf8');
    eventBus.emitSync('config:saved', { config: normalizedConfig });
  } catch (error) {
    console.error(`保存配置失败 (${configFilePath}):`, error.message);
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  expandHome,
  resolveClaudeProjectsDir,
  normalizeConfigForSave,
  isDefaultProjectsDir,
  getConfigFilePath
};
