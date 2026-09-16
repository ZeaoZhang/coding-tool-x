// 默认配置
const path = require('path');
const os = require('os');
const { resolvePreferredHomeDir } = require('../utils/home-dir');
const modelMetadataConfig = require('./model-metadata.json');

const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());
const CLAUDE_CONFIG_DIR = (typeof process.env.CLAUDE_CONFIG_DIR === 'string' && process.env.CLAUDE_CONFIG_DIR.trim())
  ? process.env.CLAUDE_CONFIG_DIR.trim()
  : path.join(HOME_DIR, '.claude');

const DEFAULT_CONFIG = {
  projectsDir: path.join(CLAUDE_CONFIG_DIR, 'projects'),
  defaultProject: null,
  maxDisplaySessions: 100,
  pageSize: 15,
  currentCliType: 'claude',  // 当前CLI工具类型: claude, codex, gemini, opencode, omp
  ports: {
    webUI: 19999,       // Web UI 页面端口 (同时用于 WebSocket)
    proxy: 20088,       // Claude 代理服务端口
    codexProxy: 20089,  // Codex 代理服务端口
    geminiProxy: 20090, // Gemini 代理服务端口
    opencodeProxy: 20091, // OpenCode 代理服务端口
    ompProxy: 20092       // OMP 专用动态网关端口
  },
  maxLogs: 100,
  statsInterval: 30,
  nativeCliLogs: {
    enabled: true,
    intervalSeconds: 5
  },
  modelDiscovery: {
    useV1ModelsEndpoint: false
  },
  defaultModels: modelMetadataConfig.defaultModels || {},
  defaultSpeedTestModels: modelMetadataConfig.defaultSpeedTestModels || {}
};

module.exports = DEFAULT_CONFIG;
