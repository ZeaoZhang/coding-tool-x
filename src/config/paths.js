// CTX 工具路径配置
// 所有路径统一使用 ~/.cc-tool 目录
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolvePreferredHomeDir } = require('../utils/home-dir');

const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());

// 基础目录
const CC_TOOL_BASE_DIR = path.join(HOME_DIR, '.cc-tool');
// 兼容旧变量名，避免外部调用方断裂
const CTX_BASE_DIR = CC_TOOL_BASE_DIR;

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

function ensureStorageDirMigrated() {
  if (migrationChecked) {
    return CC_TOOL_BASE_DIR;
  }
  migrationChecked = true;

  if (!fs.existsSync(CC_TOOL_BASE_DIR)) {
    fs.mkdirSync(CC_TOOL_BASE_DIR, { recursive: true });
  }

  LEGACY_BASE_DIRS.forEach((legacyDir) => {
    if (!fs.existsSync(legacyDir)) return;
    try {
      mergeDirectory(legacyDir, CC_TOOL_BASE_DIR);
    } catch (error) {
      console.warn(`[paths] 迁移目录失败: ${legacyDir} -> ${CC_TOOL_BASE_DIR}`, error.message);
    }
  });

  return CC_TOOL_BASE_DIR;
}

// 路径配置
const PATHS = {
  // 基础目录
  base: CC_TOOL_BASE_DIR,

  // 项目目录（存储项目配置和会话）
  projects: path.join(CC_TOOL_BASE_DIR, 'projects'),

  // 配置文件目录
  config: path.join(CC_TOOL_BASE_DIR, 'config'),
  configFile: path.join(CC_TOOL_BASE_DIR, 'config.json'),

  // 日志目录
  logs: path.join(CC_TOOL_BASE_DIR, 'logs'),

  // 别名存储
  aliases: path.join(CC_TOOL_BASE_DIR, 'aliases.json'),

  // 收藏夹存储
  favorites: path.join(CC_TOOL_BASE_DIR, 'favorites.json'),

  // 渠道配置
  channels: {
    claude: path.join(CC_TOOL_BASE_DIR, 'channels.json'),
    codex: path.join(CC_TOOL_BASE_DIR, 'codex-channels.json'),
    gemini: path.join(CC_TOOL_BASE_DIR, 'gemini-channels.json'),
    opencode: path.join(CC_TOOL_BASE_DIR, 'opencode-channels.json')
  },

  // 激活渠道标记
  activeChannel: {
    claude: path.join(CC_TOOL_BASE_DIR, 'active-channel.json'),
    codex: path.join(CC_TOOL_BASE_DIR, 'codex-active-channel.json'),
    gemini: path.join(CC_TOOL_BASE_DIR, 'gemini-active-channel.json'),
    opencode: path.join(CC_TOOL_BASE_DIR, 'opencode-active-channel.json')
  },

  // 统计数据
  statistics: {
    claude: path.join(CC_TOOL_BASE_DIR, 'statistics.json'),
    codex: path.join(CC_TOOL_BASE_DIR, 'codex-statistics.json'),
    gemini: path.join(CC_TOOL_BASE_DIR, 'gemini-statistics.json'),
    opencode: path.join(CC_TOOL_BASE_DIR, 'opencode-statistics.json'),
    dailyStats: {
      claude: path.join(CC_TOOL_BASE_DIR, 'daily-stats'),
      codex: path.join(CC_TOOL_BASE_DIR, 'codex-daily-stats'),
      gemini: path.join(CC_TOOL_BASE_DIR, 'gemini-daily-stats'),
      opencode: path.join(CC_TOOL_BASE_DIR, 'opencode-daily-stats')
    }
  },

  // 会话缓存
  sessionCache: path.join(CC_TOOL_BASE_DIR, 'session-cache.json'),

  // 项目顺序
  projectOrder: path.join(CC_TOOL_BASE_DIR, 'project-order.json'),

  // 环境备份
  envBackups: path.join(CC_TOOL_BASE_DIR, 'env-backups'),

  // UI 配置
  uiConfig: path.join(CC_TOOL_BASE_DIR, 'ui-config.json'),

  // 飞书通知脚本
  notifyHook: path.join(CC_TOOL_BASE_DIR, 'notify-hook.js'),

  // Skills 安装目录（注意：这个仍使用 Claude 原生路径）
  skills: path.join(HOME_DIR, '.claude', 'skills'),

  // MCP 配置（注意：这个仍使用 Claude 原生路径）
  mcpConfig: path.join(CC_TOOL_BASE_DIR, 'mcp-config.json'),

  // Prompts
  prompts: path.join(CC_TOOL_BASE_DIR, 'prompts.json'),

  // 代理运行时状态
  proxyRuntime: {
    claude: path.join(CC_TOOL_BASE_DIR, 'proxy-runtime.json'),
    codex: path.join(CC_TOOL_BASE_DIR, 'codex-proxy-runtime.json'),
    gemini: path.join(CC_TOOL_BASE_DIR, 'gemini-proxy-runtime.json'),
    opencode: path.join(CC_TOOL_BASE_DIR, 'opencode-proxy-runtime.json')
  }
};

// 工具特定的原生配置路径（不改变）
const NATIVE_PATHS = {
  // Claude Code 原生配置
  claude: {
    settings: path.join(HOME_DIR, '.claude', 'settings.json'),
    settingsBackup: path.join(HOME_DIR, '.claude', 'settings.json.cc-tool-backup'),
    projects: path.join(HOME_DIR, '.claude', 'projects')
  },

  // Codex 原生配置
  codex: {
    config: path.join(HOME_DIR, '.codex', 'config.toml'),
    configBackup: path.join(HOME_DIR, '.codex', 'config.toml.cc-tool-backup'),
    auth: path.join(HOME_DIR, '.codex', 'auth.json'),
    authBackup: path.join(HOME_DIR, '.codex', 'auth.json.cc-tool-backup'),
    sessions: path.join(HOME_DIR, '.codex', 'sessions')
  },

  // Gemini 原生配置
  gemini: {
    env: path.join(HOME_DIR, '.gemini', '.env'),
    envBackup: path.join(HOME_DIR, '.gemini', '.env.cc-tool-backup'),
    tmp: path.join(HOME_DIR, '.gemini', 'tmp')
  },

  // OpenCode 原生配置
  opencode: {
    data: path.join(HOME_DIR, '.local', 'share', 'opencode'),
    config: path.join(HOME_DIR, '.config', 'opencode'),
    sessions: path.join(HOME_DIR, '.local', 'share', 'opencode', 'storage', 'session'),
    projects: path.join(HOME_DIR, '.local', 'share', 'opencode', 'storage', 'project'),
    messages: path.join(HOME_DIR, '.local', 'share', 'opencode', 'storage', 'message'),
    log: path.join(HOME_DIR, '.local', 'share', 'opencode', 'log')
  }
};

module.exports = {
  PATHS,
  NATIVE_PATHS,
  HOME_DIR,
  CTX_BASE_DIR,
  CC_TOOL_BASE_DIR,
  LEGACY_BASE_DIRS,
  ensureStorageDirMigrated
};
