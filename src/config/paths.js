// CTX 工具路径配置
// 所有路径统一使用 ~/.cc-tool 目录
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { resolvePreferredHomeDir, isWindowsLikePlatform } = require('../utils/home-dir');

const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());

// 基础目录
const CC_TOOL_BASE_DIR = path.join(HOME_DIR, '.cc-tool');
// 兼容旧变量名，避免外部调用方断裂
const CTX_BASE_DIR = CC_TOOL_BASE_DIR;
const CONFIG_DIR = path.join(CC_TOOL_BASE_DIR, 'config');
const CONFIGS_DIR = path.join(CC_TOOL_BASE_DIR, 'configs');
const STORAGE_DIR = path.join(CC_TOOL_BASE_DIR, 'storage');
const CHANNELS_DIR = path.join(STORAGE_DIR, 'channels');
const ACTIVE_CHANNELS_DIR = path.join(CHANNELS_DIR, 'active');
const STATS_DIR = path.join(STORAGE_DIR, 'stats');
const DAILY_STATS_DIR = path.join(STATS_DIR, 'daily');
const REQUEST_LOGS_DIR = path.join(STATS_DIR, 'request-logs');
const RUNTIME_DIR = path.join(STORAGE_DIR, 'runtime');
const CACHE_DIR = path.join(STORAGE_DIR, 'cache');
const CACHE_SKILLS_DIR = path.join(CACHE_DIR, 'skills');
const CACHE_PLUGINS_DIR = path.join(CACHE_DIR, 'plugins');
const REPOS_DIR = path.join(STORAGE_DIR, 'repos');
const REPOS_SKILLS_DIR = path.join(REPOS_DIR, 'skills');
const REPOS_PLUGINS_DIR = path.join(REPOS_DIR, 'plugins');
const LOCAL_DIR = path.join(STORAGE_DIR, 'local');
const LOCAL_SKILLS_DIR = path.join(LOCAL_DIR, 'skills');
const REQUESTS_DIR = path.join(STORAGE_DIR, 'requests');
const BACKUPS_DIR = path.join(STORAGE_DIR, 'backups');
const SCRIPTS_DIR = path.join(STORAGE_DIR, 'scripts');
const LEGACY_DIR = path.join(STORAGE_DIR, 'legacy');
const LEGACY_CONFLICTS_DIR = path.join(LEGACY_DIR, 'root-conflicts');
const LEGACY_ROOT_BACKUPS_DIR = path.join(LEGACY_DIR, 'root-backups');
const LEGACY_IMPORT_STATE_FILE = path.join(LEGACY_DIR, 'import-state.json');
const LEGACY_STATS_DIR = path.join(LEGACY_DIR, 'stats');

// 旧目录（升级时自动合并到 ~/.cc-tool）
const LEGACY_BASE_DIRS = [
  path.join(HOME_DIR, '.claude', 'ctx'),
  path.join(HOME_DIR, '.claude', 'cc-tool')
];

let migrationChecked = false;

function mergeDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;

  const sourceStat = fs.statSync(sourceDir);
  if (sourceStat.isDirectory()) {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const entries = fs.readdirSync(sourceDir);
    entries.forEach((entry) => {
      mergeDirectory(path.join(sourceDir, entry), path.join(targetDir, entry));
    });
    return;
  }

  if (!fs.existsSync(targetDir)) {
    fs.copyFileSync(sourceDir, targetDir);
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function filesAreEqual(sourcePath, targetPath) {
  try {
    const sourceStat = fs.statSync(sourcePath);
    const targetStat = fs.statSync(targetPath);
    if (!sourceStat.isFile() || !targetStat.isFile()) {
      return false;
    }
    if (sourceStat.size !== targetStat.size) {
      return false;
    }
    return fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath));
  } catch {
    return false;
  }
}

function getUniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const timestamp = Date.now();
  let counter = 1;
  let candidate = `${targetPath}.bak-${timestamp}`;
  while (fs.existsSync(candidate)) {
    candidate = `${targetPath}.bak-${timestamp}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function tryRemoveEmptyDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return;
    if (fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    // ignore cleanup failures
  }
}

function getRelativeLegacyPath(entryPath) {
  const relativePath = path.relative(CC_TOOL_BASE_DIR, entryPath);
  if (!relativePath || relativePath.startsWith('..')) {
    return path.basename(entryPath);
  }
  return relativePath;
}

function archiveLegacyEntry(entryPath, archiveRootDir) {
  if (!fs.existsSync(entryPath)) {
    return '';
  }
  const archivePath = getUniquePath(path.join(archiveRootDir, getRelativeLegacyPath(entryPath)));
  try {
    moveFile(entryPath, archivePath);
  } catch (error) {
    if (!fs.existsSync(entryPath)) {
      return '';
    }
    throw error;
  }
  return archivePath;
}

function moveFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  try {
    fs.renameSync(sourcePath, targetPath);
    return;
  } catch (error) {
    fs.copyFileSync(sourcePath, targetPath);
    try {
      fs.unlinkSync(sourcePath);
    } catch {
      console.warn(`[paths] 清理旧文件失败: ${sourcePath}`);
    }
  }
}

function readJsonFileSafe(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, 'utf8'))
    };
  } catch {
    return {
      ok: false,
      value: null
    };
  }
}

function buildArrayItemIdentity(item) {
  if (item === null) {
    return 'null';
  }
  if (typeof item !== 'object') {
    return `${typeof item}:${String(item)}`;
  }
  if (item.id) {
    return `id:${item.id}`;
  }
  if (item.key) {
    return `key:${item.key}`;
  }
  if (item.repoUrl) {
    return `repo:${item.repoUrl}`;
  }
  if (item.path) {
    return `path:${item.path}`;
  }
  if (item.url) {
    return `url:${item.url}`;
  }
  if (item.owner && item.name) {
    return `repo:${item.owner}/${item.name}`;
  }
  if (item.name) {
    return `name:${item.name}`;
  }
  return `json:${JSON.stringify(item)}`;
}

function mergeJsonValues(primaryValue, secondaryValue) {
  if (primaryValue === undefined) {
    return cloneJsonValue(secondaryValue);
  }
  if (secondaryValue === undefined) {
    return cloneJsonValue(primaryValue);
  }

  if (Array.isArray(primaryValue) && Array.isArray(secondaryValue)) {
    const merged = [];
    const seen = new Map();

    const appendItem = (item) => {
      const identity = buildArrayItemIdentity(item);
      if (!seen.has(identity)) {
        seen.set(identity, merged.length);
        merged.push(cloneJsonValue(item));
        return;
      }

      const index = seen.get(identity);
      merged[index] = mergeJsonValues(merged[index], item);
    };

    primaryValue.forEach(appendItem);
    secondaryValue.forEach(appendItem);
    return merged;
  }

  if (isPlainObject(primaryValue) && isPlainObject(secondaryValue)) {
    const merged = cloneJsonValue(primaryValue);
    Object.keys(secondaryValue).forEach((key) => {
      if (!(key in merged)) {
        merged[key] = cloneJsonValue(secondaryValue[key]);
        return;
      }
      merged[key] = mergeJsonValues(merged[key], secondaryValue[key]);
    });
    return merged;
  }

  return cloneJsonValue(primaryValue);
}

function writeJsonFile(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2), 'utf8');
}

function copyFilePreserveMode(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  try {
    fs.chmodSync(targetPath, fs.statSync(sourcePath).mode);
  } catch {
    // ignore permission sync failures
  }
}

function resolveFileConflict(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath) || !fs.existsSync(targetPath)) {
    return;
  }

  const sourceStat = fs.statSync(sourcePath);
  const targetStat = fs.statSync(targetPath);
  const preferSource = sourceStat.mtimeMs >= targetStat.mtimeMs;
  const primaryPath = preferSource ? sourcePath : targetPath;
  const secondaryPath = preferSource ? targetPath : sourcePath;
  const primaryJson = readJsonFileSafe(primaryPath);
  const secondaryJson = readJsonFileSafe(secondaryPath);

  if (primaryJson.ok && secondaryJson.ok) {
    const merged = mergeJsonValues(primaryJson.value, secondaryJson.value);
    writeJsonFile(targetPath, merged);
    const archivedPath = archiveLegacyEntry(sourcePath, LEGACY_CONFLICTS_DIR);
    if (archivedPath) {
      console.warn(`[paths] 已归档并合并冲突旧文件: ${sourcePath} -> ${archivedPath}`);
    }
    return;
  }

  if (preferSource) {
    copyFilePreserveMode(sourcePath, targetPath);
  }

  const archivedPath = archiveLegacyEntry(sourcePath, LEGACY_CONFLICTS_DIR);
  if (archivedPath) {
    console.warn(`[paths] 已归档冲突旧文件，保留较新版本: ${sourcePath} -> ${archivedPath}`);
  }
}

function relocateEntry(sourcePath, targetPath) {
  if (!sourcePath || !targetPath || sourcePath === targetPath || !fs.existsSync(sourcePath)) {
    return;
  }

  let sourceStat;
  try {
    sourceStat = fs.statSync(sourcePath);
  } catch {
    return;
  }

  if (sourceStat.isDirectory()) {
    if (!fs.existsSync(targetPath)) {
      ensureDir(path.dirname(targetPath));
      try {
        fs.renameSync(sourcePath, targetPath);
        return;
      } catch {
        ensureDir(targetPath);
      }
    } else {
      ensureDir(targetPath);
    }

    const entries = fs.readdirSync(sourcePath);
    entries.forEach((entry) => {
      relocateEntry(path.join(sourcePath, entry), path.join(targetPath, entry));
    });
    tryRemoveEmptyDir(sourcePath);
    return;
  }

  if (!fs.existsSync(targetPath)) {
    moveFile(sourcePath, targetPath);
    return;
  }

  if (filesAreEqual(sourcePath, targetPath)) {
    try {
      fs.unlinkSync(sourcePath);
    } catch {
      // ignore duplicate cleanup failures
    }
    return;
  }

  resolveFileConflict(sourcePath, targetPath);
}

function rootEntry(name) {
  return path.join(CC_TOOL_BASE_DIR, name);
}

function getRepoScannerReposPath(type) {
  return path.join(REPOS_DIR, `${type}.json`);
}

function getRepoScannerCachePath(type) {
  return path.join(CACHE_DIR, `${type}-cache.json`);
}

const PATHS = {
  // 基础目录
  base: CC_TOOL_BASE_DIR,
  config: CONFIG_DIR,
  configs: CONFIGS_DIR,
  storage: STORAGE_DIR,
  logs: path.join(CC_TOOL_BASE_DIR, 'logs'),
  projects: path.join(CC_TOOL_BASE_DIR, 'projects'),
  plugins: path.join(CC_TOOL_BASE_DIR, 'plugins'),

  // 全局配置
  configFile: path.join(CONFIG_DIR, 'config.json'),
  uiConfig: path.join(CONFIG_DIR, 'ui-config.json'),
  platforms: path.join(CONFIG_DIR, 'platforms.json'),
  prompts: path.join(CONFIG_DIR, 'prompts.json'),
  mcpConfig: path.join(CONFIG_DIR, 'mcp-servers.json'),
  mcpServers: path.join(CONFIG_DIR, 'mcp-servers.json'),
  configRegistry: path.join(CONFIG_DIR, 'config-registry.json'),
  oauthCredentials: path.join(CONFIG_DIR, 'oauth-credentials.json'),
  security: path.join(CONFIG_DIR, 'security.json'),
  workspaces: path.join(CONFIG_DIR, 'workspaces.json'),
  aliases: path.join(CONFIG_DIR, 'aliases.json'),
  favorites: path.join(CONFIG_DIR, 'favorites.json'),
  projectOrder: path.join(CONFIG_DIR, 'project-order.json'),
  sessionOrder: path.join(CONFIG_DIR, 'session-order.json'),
  forkRelations: path.join(CONFIG_DIR, 'fork-relations.json'),
  opencodeProjectOrder: path.join(CONFIG_DIR, 'opencode-project-order.json'),
  opencodeSessionOrder: path.join(CONFIG_DIR, 'opencode-session-order.json'),
  ompProjectOrder: path.join(CONFIG_DIR, 'omp-project-order.json'),
  ompSessionOrder: path.join(CONFIG_DIR, 'omp-session-order.json'),

  // 渠道配置
  channelsDir: CHANNELS_DIR,
  channels: {
    claude: path.join(CHANNELS_DIR, 'claude.json'),
    codex: path.join(CHANNELS_DIR, 'codex.json'),
    gemini: path.join(CHANNELS_DIR, 'gemini.json'),
    opencode: path.join(CHANNELS_DIR, 'opencode.json'),
    omp: path.join(CHANNELS_DIR, 'omp.json')
  },
  activeChannelDir: ACTIVE_CHANNELS_DIR,
  activeChannel: {
    claude: path.join(ACTIVE_CHANNELS_DIR, 'claude.json'),
    codex: path.join(ACTIVE_CHANNELS_DIR, 'codex.json'),
    gemini: path.join(ACTIVE_CHANNELS_DIR, 'gemini.json'),
    opencode: path.join(ACTIVE_CHANNELS_DIR, 'opencode.json'),
    omp: path.join(ACTIVE_CHANNELS_DIR, 'omp.json')
  },

  // 统计与日志快照
  statistics: {
    dir: STATS_DIR,
    summary: path.join(STATS_DIR, 'statistics.json'),
    dailyStats: DAILY_STATS_DIR,
    requestLogs: REQUEST_LOGS_DIR,
    proxyLogs: path.join(STATS_DIR, 'proxy-logs.json'),
    legacy: {
      claudeSummary: path.join(LEGACY_STATS_DIR, 'statistics.json'),
      codexSummary: path.join(LEGACY_STATS_DIR, 'codex-statistics.json'),
      geminiSummary: path.join(LEGACY_STATS_DIR, 'gemini-statistics.json'),
      opencodeSummary: path.join(LEGACY_STATS_DIR, 'opencode-statistics.json'),
      codexDaily: path.join(LEGACY_STATS_DIR, 'codex-daily-stats'),
      geminiDaily: path.join(LEGACY_STATS_DIR, 'gemini-daily-stats'),
      opencodeDaily: path.join(LEGACY_STATS_DIR, 'opencode-daily-stats')
    }
  },

  // 运行时、缓存、备份
  cache: CACHE_DIR,
  snapshotCache: path.join(CACHE_DIR, 'snapshots'),
  sessionCache: path.join(CACHE_DIR, 'session-cache.json'),
  sessionHasCache: path.join(CACHE_DIR, 'session-has-cache.json'),
  channelModels: path.join(CACHE_DIR, 'channel-models.json'),
  channelBalanceStrategies: path.join(CACHE_DIR, 'channel-balance-strategies.json'),
  sessionHistoryIndex: path.join(CACHE_DIR, 'session-history.sqlite'),
  envBackups: path.join(BACKUPS_DIR, 'env'),
  proxyRuntime: {
    claude: path.join(RUNTIME_DIR, 'claude-proxy.json'),
    codex: path.join(RUNTIME_DIR, 'codex-proxy.json'),
    gemini: path.join(RUNTIME_DIR, 'gemini-proxy.json'),
    opencode: path.join(RUNTIME_DIR, 'opencode-proxy.json'),
    omp: path.join(RUNTIME_DIR, 'omp-proxy.json')
  },
  ompGatewaySecret: path.join(RUNTIME_DIR, 'omp-gateway-secret'),

  // 请求记录
  requestSnapshots: {
    claude: path.join(REQUESTS_DIR, 'claude.jsonl'),
    codex: path.join(REQUESTS_DIR, 'codex.jsonl'),
    gemini: path.join(REQUESTS_DIR, 'gemini.jsonl'),
    opencode: path.join(REQUESTS_DIR, 'opencode.jsonl'),
    omp: path.join(REQUESTS_DIR, 'omp.jsonl')
  },
  claudeRequestTemplate: path.join(REQUESTS_DIR, 'claude-request-template.json'),

  // 脚本
  notifyHook: path.join(SCRIPTS_DIR, 'notify-hook.js'),

  // 技能与插件（cc-tool 托管部分）
  localSkills: {
    claude: path.join(LOCAL_SKILLS_DIR, 'claude'),
    codex: path.join(LOCAL_SKILLS_DIR, 'codex'),
    gemini: path.join(LOCAL_SKILLS_DIR, 'gemini'),
    opencode: path.join(LOCAL_SKILLS_DIR, 'opencode'),
    omp: path.join(LOCAL_SKILLS_DIR, 'omp')
  },
  skillRepos: {
    claude: path.join(REPOS_SKILLS_DIR, 'claude.json'),
    codex: path.join(REPOS_SKILLS_DIR, 'codex.json'),
    gemini: path.join(REPOS_SKILLS_DIR, 'gemini.json'),
    opencode: path.join(REPOS_SKILLS_DIR, 'opencode.json'),
    omp: path.join(REPOS_SKILLS_DIR, 'omp.json')
  },
  skillCaches: {
    claude: path.join(CACHE_SKILLS_DIR, 'claude.json'),
    codex: path.join(CACHE_SKILLS_DIR, 'codex.json'),
    gemini: path.join(CACHE_SKILLS_DIR, 'gemini.json'),
    opencode: path.join(CACHE_SKILLS_DIR, 'opencode.json'),
    omp: path.join(CACHE_SKILLS_DIR, 'omp.json')
  },
  pluginRepos: {
    claude: path.join(REPOS_PLUGINS_DIR, 'claude.json'),
    codex: path.join(REPOS_PLUGINS_DIR, 'codex.json'),
    gemini: path.join(REPOS_PLUGINS_DIR, 'gemini.json'),
    opencode: path.join(REPOS_PLUGINS_DIR, 'opencode.json'),
    omp: path.join(REPOS_PLUGINS_DIR, 'omp.json')
  },
  pluginMarketCache: {
    claude: path.join(CACHE_PLUGINS_DIR, 'claude-market.json'),
    codex: path.join(CACHE_PLUGINS_DIR, 'codex-market.json'),
    gemini: path.join(CACHE_PLUGINS_DIR, 'gemini-market.json'),
    opencode: path.join(CACHE_PLUGINS_DIR, 'opencode-market.json'),
    omp: path.join(CACHE_PLUGINS_DIR, 'omp-market.json')
  },

  // 原生路径兼容
  skills: path.join(getClaudeConfigDir(), 'skills'),

  // 旧版本遗留文件搬迁目标
  legacy: {
    dir: LEGACY_DIR,
    rootConflicts: LEGACY_CONFLICTS_DIR,
    rootBackups: LEGACY_ROOT_BACKUPS_DIR,
    importState: LEGACY_IMPORT_STATE_FILE,
    oauthTokens: path.join(LEGACY_DIR, 'oauth-tokens.json')
  },

  // RepoScannerBase 的通用路径
  repoScanner: {
    reposDir: REPOS_DIR,
    cacheDir: CACHE_DIR
  }
};

const LEGACY_STORAGE_RELOCATIONS = [
  // 全局配置文件
  { source: rootEntry('config.json'), target: PATHS.configFile },
  { source: rootEntry('ui-config.json'), target: PATHS.uiConfig },
  { source: rootEntry('prompts.json'), target: PATHS.prompts },
  { source: rootEntry('mcp-servers.json'), target: PATHS.mcpServers },
  { source: rootEntry('mcp-config.json'), target: PATHS.mcpServers },
  { source: rootEntry('config-registry.json'), target: PATHS.configRegistry },
  { source: rootEntry('oauth-credentials.json'), target: PATHS.oauthCredentials },
  { source: rootEntry('security.json'), target: PATHS.security },
  { source: rootEntry('workspaces.json'), target: PATHS.workspaces },
  { source: rootEntry('aliases.json'), target: PATHS.aliases },
  { source: rootEntry('favorites.json'), target: PATHS.favorites },
  { source: rootEntry('project-order.json'), target: PATHS.projectOrder },
  { source: rootEntry('session-order.json'), target: PATHS.sessionOrder },
  { source: rootEntry('fork-relations.json'), target: PATHS.forkRelations },
  { source: rootEntry('opencode-project-order.json'), target: PATHS.opencodeProjectOrder },
  { source: rootEntry('opencode-session-order.json'), target: PATHS.opencodeSessionOrder },
  { source: rootEntry('omp-project-order.json'), target: PATHS.ompProjectOrder },
  { source: rootEntry('omp-session-order.json'), target: PATHS.ompSessionOrder },

  // 渠道相关
  { source: rootEntry('channels.json'), target: PATHS.channels.claude },
  { source: rootEntry('codex-channels.json'), target: PATHS.channels.codex },
  { source: rootEntry('gemini-channels.json'), target: PATHS.channels.gemini },
  { source: rootEntry('opencode-channels.json'), target: PATHS.channels.opencode },
  { source: rootEntry('omp-channels.json'), target: PATHS.channels.omp },
  { source: rootEntry('active-channel.json'), target: PATHS.activeChannel.claude },
  { source: rootEntry('codex-active-channel.json'), target: PATHS.activeChannel.codex },
  { source: rootEntry('gemini-active-channel.json'), target: PATHS.activeChannel.gemini },
  { source: rootEntry('opencode-active-channel.json'), target: PATHS.activeChannel.opencode },
  { source: rootEntry('omp-active-channel.json'), target: PATHS.activeChannel.omp },

  // 统计与日志
  { source: rootEntry('statistics.json'), target: PATHS.statistics.summary },
  { source: rootEntry('daily-stats'), target: PATHS.statistics.dailyStats },
  { source: rootEntry('request-logs'), target: PATHS.statistics.requestLogs },
  { source: rootEntry('proxy-logs.json'), target: PATHS.statistics.proxyLogs },
  { source: rootEntry('codex-statistics.json'), target: PATHS.statistics.legacy.codexSummary },
  { source: rootEntry('gemini-statistics.json'), target: PATHS.statistics.legacy.geminiSummary },
  { source: rootEntry('opencode-statistics.json'), target: PATHS.statistics.legacy.opencodeSummary },
  { source: rootEntry('codex-daily-stats'), target: PATHS.statistics.legacy.codexDaily },
  { source: rootEntry('gemini-daily-stats'), target: PATHS.statistics.legacy.geminiDaily },
  { source: rootEntry('opencode-daily-stats'), target: PATHS.statistics.legacy.opencodeDaily },

  // 缓存、运行时、脚本
  { source: rootEntry('session-cache.json'), target: PATHS.sessionCache },
  { source: rootEntry('session-has-cache.json'), target: PATHS.sessionHasCache },
  { source: rootEntry('channel-models.json'), target: PATHS.channelModels },
  { source: rootEntry('proxy-runtime.json'), target: PATHS.proxyRuntime.claude },
  { source: rootEntry('claude-proxy-runtime.json'), target: PATHS.proxyRuntime.claude },
  { source: rootEntry('codex-proxy-runtime.json'), target: PATHS.proxyRuntime.codex },
  { source: rootEntry('gemini-proxy-runtime.json'), target: PATHS.proxyRuntime.gemini },
  { source: rootEntry('opencode-proxy-runtime.json'), target: PATHS.proxyRuntime.opencode },
  { source: rootEntry('omp-proxy-runtime.json'), target: PATHS.proxyRuntime.omp },
  { source: rootEntry('notify-hook.js'), target: PATHS.notifyHook },
  { source: rootEntry('claude-request-template.json'), target: PATHS.claudeRequestTemplate },
  { source: rootEntry('claude-requests.jsonl'), target: PATHS.requestSnapshots.claude },
  { source: rootEntry('codex-requests.jsonl'), target: PATHS.requestSnapshots.codex },
  { source: rootEntry('gemini-requests.jsonl'), target: PATHS.requestSnapshots.gemini },
  { source: rootEntry('opencode-requests.jsonl'), target: PATHS.requestSnapshots.opencode },
  { source: rootEntry('omp-requests.jsonl'), target: PATHS.requestSnapshots.omp },

  // 备份
  { source: rootEntry('env-backups'), target: PATHS.envBackups },

  // 技能托管
  { source: rootEntry('skills'), target: PATHS.localSkills.claude },
  { source: rootEntry('codex-skills'), target: PATHS.localSkills.codex },
  { source: rootEntry('gemini-skills'), target: PATHS.localSkills.gemini },
  { source: rootEntry('opencode-skills'), target: PATHS.localSkills.opencode },
  { source: rootEntry('omp-skills'), target: PATHS.localSkills.omp },
  { source: rootEntry('skill-repos.json'), target: PATHS.skillRepos.claude },
  { source: rootEntry('codex-skill-repos.json'), target: PATHS.skillRepos.codex },
  { source: rootEntry('gemini-skill-repos.json'), target: PATHS.skillRepos.gemini },
  { source: rootEntry('opencode-skill-repos.json'), target: PATHS.skillRepos.opencode },
  { source: rootEntry('omp-skill-repos.json'), target: PATHS.skillRepos.omp },
  { source: rootEntry('skills-cache.json'), target: PATHS.skillCaches.claude },
  { source: rootEntry('codex-skills-cache.json'), target: PATHS.skillCaches.codex },
  { source: rootEntry('gemini-skills-cache.json'), target: PATHS.skillCaches.gemini },
  { source: rootEntry('opencode-skills-cache.json'), target: PATHS.skillCaches.opencode },
  { source: rootEntry('omp-skills-cache.json'), target: PATHS.skillCaches.omp },

  // 插件仓库缓存
  { source: rootEntry('plugin-repos.json'), target: PATHS.pluginRepos.claude },
  { source: rootEntry('codex-plugin-repos.json'), target: PATHS.pluginRepos.codex },
  { source: rootEntry('gemini-plugin-repos.json'), target: PATHS.pluginRepos.gemini },
  { source: rootEntry('opencode-plugin-repos.json'), target: PATHS.pluginRepos.opencode },
  { source: rootEntry('omp-plugin-repos.json'), target: PATHS.pluginRepos.omp },
  { source: rootEntry('plugins-market-cache.json'), target: PATHS.pluginMarketCache.claude },
  { source: rootEntry('codex-plugins-market-cache.json'), target: PATHS.pluginMarketCache.codex },
  { source: rootEntry('gemini-plugins-market-cache.json'), target: PATHS.pluginMarketCache.gemini },
  { source: rootEntry('opencode-plugins-market-cache.json'), target: PATHS.pluginMarketCache.opencode },
  { source: rootEntry('omp-plugins-market-cache.json'), target: PATHS.pluginMarketCache.omp },

  // 已废弃但需要保留的数据
  { source: rootEntry('oauth-tokens.json'), target: PATHS.legacy.oauthTokens }
];

function cleanupLegacyRootBackups() {
  if (!fs.existsSync(CC_TOOL_BASE_DIR)) {
    return;
  }

  const rootEntries = fs.readdirSync(CC_TOOL_BASE_DIR);
  rootEntries.forEach((entry) => {
    if (!/\.bak-\d/.test(entry)) {
      return;
    }

    const entryPath = path.join(CC_TOOL_BASE_DIR, entry);
    try {
      const stat = fs.statSync(entryPath);
      if (!stat.isFile()) {
        return;
      }
      const archivedPath = archiveLegacyEntry(entryPath, LEGACY_ROOT_BACKUPS_DIR);
      if (archivedPath) {
        console.warn(`[paths] 已迁移旧备份文件: ${entryPath} -> ${archivedPath}`);
      }
    } catch (error) {
      console.warn(`[paths] 迁移旧备份文件失败: ${entryPath}`, error.message);
    }
  });
}

function cleanupEmptyLegacyRoots() {
  const legacyRoots = new Set(
    LEGACY_STORAGE_RELOCATIONS
      .map(({ source }) => source)
      .filter((sourcePath) => path.dirname(sourcePath) === CC_TOOL_BASE_DIR)
  );

  legacyRoots.forEach((entryPath) => {
    tryRemoveEmptyDir(entryPath);
  });
}

function loadLegacyImportState() {
  const state = readJsonFileSafe(LEGACY_IMPORT_STATE_FILE);
  if (!state.ok || !isPlainObject(state.value)) {
    return { importedSources: {} };
  }

  return {
    importedSources: isPlainObject(state.value.importedSources) ? state.value.importedSources : {}
  };
}

function saveLegacyImportState(state) {
  writeJsonFile(LEGACY_IMPORT_STATE_FILE, {
    importedSources: isPlainObject(state?.importedSources) ? state.importedSources : {}
  });
}

function importLegacyBaseDirsOnce() {
  const importState = loadLegacyImportState();
  let stateChanged = false;

  LEGACY_BASE_DIRS.forEach((legacyDir) => {
    if (!fs.existsSync(legacyDir)) {
      return;
    }

    if (importState.importedSources[legacyDir]?.importedAt) {
      return;
    }

    try {
      mergeDirectory(legacyDir, CC_TOOL_BASE_DIR);
      importState.importedSources[legacyDir] = {
        importedAt: new Date().toISOString()
      };
      stateChanged = true;
    } catch (error) {
      console.warn(`[paths] 迁移目录失败: ${legacyDir} -> ${CC_TOOL_BASE_DIR}`, error.message);
    }
  });

  if (stateChanged) {
    saveLegacyImportState(importState);
  }
}

function ensureStorageDirMigrated() {
  if (migrationChecked) {
    return CC_TOOL_BASE_DIR;
  }
  migrationChecked = true;

  ensureDir(CC_TOOL_BASE_DIR);

  importLegacyBaseDirsOnce();

  LEGACY_STORAGE_RELOCATIONS.forEach(({ source, target }) => {
    try {
      relocateEntry(source, target);
    } catch (error) {
      console.warn(`[paths] 迁移存储项失败: ${source} -> ${target}`, error.message);
    }
  });

  cleanupLegacyRootBackups();
  cleanupEmptyLegacyRoots();

  return CC_TOOL_BASE_DIR;
}

function resolveExistingEnvPath(envValue) {
  if (typeof envValue !== 'string') {
    return '';
  }
  const trimmed = envValue.trim();
  return trimmed || '';
}

function expandHomePath(input = '') {
  if (input === '~') {
    return HOME_DIR;
  }
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(HOME_DIR, input.slice(2));
  }
  return input;
}

function pickExistingDir(candidates, fallback) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

function getClaudeConfigDir() {
  return resolveExistingEnvPath(process.env.CLAUDE_CONFIG_DIR) || path.join(HOME_DIR, '.claude');
}

function getCodexDir() {
  return resolveExistingEnvPath(process.env.CODEX_HOME) || path.join(HOME_DIR, '.codex');
}

function getGeminiDir() {
  return path.join(HOME_DIR, '.gemini');
}

function getOpenCodeDataDir() {
  if (isWindowsLikePlatform(process.platform, process.env)) {
    const localAppData = resolveExistingEnvPath(process.env.LOCALAPPDATA);
    return path.join(localAppData || path.join(HOME_DIR, 'AppData', 'Local'), 'opencode');
  }

  const xdgDataHome = resolveExistingEnvPath(process.env.XDG_DATA_HOME);
  const preferredDir = path.join(xdgDataHome || path.join(HOME_DIR, '.local', 'share'), 'opencode');

  if (process.platform === 'darwin') {
    const legacyDarwinDir = path.join(HOME_DIR, 'Library', 'Application Support', 'opencode');
    return pickExistingDir([preferredDir, legacyDarwinDir], preferredDir);
  }

  return preferredDir;
}

function getOpenCodeConfigDir() {
  if (isWindowsLikePlatform(process.platform, process.env)) {
    const appData = resolveExistingEnvPath(process.env.APPDATA);
    return path.join(appData || path.join(HOME_DIR, 'AppData', 'Roaming'), 'opencode');
  }

  const xdgConfigHome = resolveExistingEnvPath(process.env.XDG_CONFIG_HOME);
  const preferredDir = path.join(xdgConfigHome || path.join(HOME_DIR, '.config'), 'opencode');

  if (process.platform === 'darwin') {
    const xdgDataHome = resolveExistingEnvPath(process.env.XDG_DATA_HOME);
    const legacyDataDir = path.join(xdgDataHome || path.join(HOME_DIR, '.local', 'share'), 'opencode');
    const legacyDarwinDir = path.join(HOME_DIR, 'Library', 'Application Support', 'opencode');
    return pickExistingDir([preferredDir, legacyDarwinDir, legacyDataDir], preferredDir);
  }

  return preferredDir;
}

function normalizeOmpProfileName(profile = '') {
  const value = String(profile || '').trim();
  return value && value !== 'default' ? value : '';
}

function getOmpAgentDir(env = process.env, options = {}) {
  if (options.resolveRuntime !== false) {
    const command = String(env.OMP_COMMAND || 'omp').trim() || 'omp';
    const commandRunner = options.commandRunner || execFileSync;
    try {
      const output = commandRunner(command, ['config', 'path'], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options.timeout || 3000,
        windowsHide: true
      });
      const configuredByCli = String(output || '').trim().split(/\r?\n/).find(Boolean);
      if (configuredByCli) {
        return path.resolve(expandHomePath(configuredByCli));
      }
    } catch {
      // Fall through to environment/profile compatibility paths.
    }
  }

  // OMP 17.x kept the historical PI_CODING_AGENT_DIR variable as the
  // canonical relocation knob. OMP_CODING_AGENT_DIR was used by older
  // cc-tool releases, so retain it as a lower-priority compatibility alias.
  const configuredDir = resolveExistingEnvPath(
    env.PI_CODING_AGENT_DIR || env.OMP_CODING_AGENT_DIR
  );
  if (configuredDir) {
    return path.resolve(expandHomePath(configuredDir));
  }
  const profile = normalizeOmpProfileName(env.OMP_PROFILE);
  const configRoot = expandHomePath(
    resolveExistingEnvPath(env.OMP_CONFIG_DIR) || path.join(HOME_DIR, '.omp')
  );
  const agentDir = profile
    ? path.join(configRoot, 'profiles', profile, 'agent')
    : path.join(configRoot, 'agent');
  return path.resolve(agentDir);
}

const OMP_AGENT_DIR = getOmpAgentDir();

// 工具特定的原生配置路径（不改变）
const NATIVE_PATHS = {
  // Claude Code 原生配置
  claude: {
    dir: getClaudeConfigDir(),
    settings: path.join(getClaudeConfigDir(), 'settings.json'),
    settingsBackup: path.join(getClaudeConfigDir(), 'settings.json.cc-tool-backup'),
    prompt: path.join(getClaudeConfigDir(), 'CLAUDE.md'),
    projects: path.join(getClaudeConfigDir(), 'projects'),
    skills: path.join(getClaudeConfigDir(), 'skills'),
    commands: path.join(getClaudeConfigDir(), 'commands'),
    agents: path.join(getClaudeConfigDir(), 'agents'),
    plugins: path.join(getClaudeConfigDir(), 'plugins'),
    mcp: path.join(HOME_DIR, '.claude.json'),
    credentials: path.join(getClaudeConfigDir(), '.credentials.json')
  },

  // Codex 原生配置
  codex: {
    dir: getCodexDir(),
    config: path.join(getCodexDir(), 'config.toml'),
    configBackup: path.join(getCodexDir(), 'config.toml.cc-tool-backup'),
    auth: path.join(getCodexDir(), 'auth.json'),
    authBackup: path.join(getCodexDir(), 'auth.json.cc-tool-backup'),
    sessions: path.join(getCodexDir(), 'sessions')
  },

  // Gemini 原生配置
  gemini: {
    dir: getGeminiDir(),
    env: path.join(getGeminiDir(), '.env'),
    envBackup: path.join(getGeminiDir(), '.env.cc-tool-backup'),
    tmp: path.join(getGeminiDir(), 'tmp'),
    settings: path.join(getGeminiDir(), 'settings.json'),
    settingsBackup: path.join(getGeminiDir(), 'settings.json.cc-tool-backup'),
    googleAccounts: path.join(getGeminiDir(), 'google_accounts.json'),
    oauthCredentialsLegacy: path.join(getGeminiDir(), 'oauth_creds.json'),
    oauthCredentialsEncrypted: path.join(getGeminiDir(), 'mcp-oauth-tokens-v2.json')
  },

  // OpenCode 原生配置
  opencode: {
    data: getOpenCodeDataDir(),
    config: getOpenCodeConfigDir(),
    sessions: path.join(getOpenCodeDataDir(), 'storage', 'session'),
    projects: path.join(getOpenCodeDataDir(), 'storage', 'project'),
    messages: path.join(getOpenCodeDataDir(), 'storage', 'message'),
    log: path.join(getOpenCodeDataDir(), 'log'),
    auth: path.join(getOpenCodeDataDir(), 'auth.json')
  },

  // OMP 原生配置。
  omp: {
    dir: OMP_AGENT_DIR,
    config: path.join(OMP_AGENT_DIR, 'config.yml'),
    settings: path.join(OMP_AGENT_DIR, 'config.yml'),
    settingsJsonLegacy: path.join(OMP_AGENT_DIR, 'settings.json'),
    auth: path.join(OMP_AGENT_DIR, 'auth.json'),
    models: path.join(OMP_AGENT_DIR, 'models.yml'),
    modelsYml: path.join(OMP_AGENT_DIR, 'models.yml'),
    modelsJsonLegacy: path.join(OMP_AGENT_DIR, 'models.json'),
    mcp: path.join(OMP_AGENT_DIR, 'mcp.json'),
    sessions: path.join(OMP_AGENT_DIR, 'sessions'),
    skills: path.join(OMP_AGENT_DIR, 'skills'),
    prompts: path.join(OMP_AGENT_DIR, 'prompts'),
    commands: path.join(OMP_AGENT_DIR, 'commands'),
    notes: path.join(OMP_AGENT_DIR, 'notes'),
    extensions: path.join(OMP_AGENT_DIR, 'extensions'),
    themes: path.join(OMP_AGENT_DIR, 'themes'),
    packages: path.join(OMP_AGENT_DIR, 'packages')
  }
};

ensureStorageDirMigrated();

module.exports = {
  PATHS,
  NATIVE_PATHS,
  HOME_DIR,
  CTX_BASE_DIR,
  CC_TOOL_BASE_DIR,
  LEGACY_BASE_DIRS,
  ensureStorageDirMigrated,
  getRepoScannerReposPath,
  getRepoScannerCachePath,
  getClaudeConfigDir,
  getCodexDir,
  getGeminiDir,
  getOpenCodeDataDir,
  getOpenCodeConfigDir,
  getOmpAgentDir
};
