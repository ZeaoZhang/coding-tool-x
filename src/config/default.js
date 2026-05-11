// 默认配置
const path = require('path');
const os = require('os');
const { resolvePreferredHomeDir } = require('../utils/home-dir');
const modelMetadataConfig = require('./model-metadata.json');

const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());

const DEFAULT_CONFIG = {
  projectsDir: path.join(HOME_DIR, '.claude', 'projects'),
  defaultProject: null,
  maxDisplaySessions: 100,
  pageSize: 15,
  currentCliType: 'claude',  // 当前CLI工具类型: claude, codex, gemini, opencode
  ports: {
    webUI: 19999,       // Web UI 页面端口 (同时用于 WebSocket)
    proxy: 20088,       // Claude 代理服务端口
    codexProxy: 20089,  // Codex 代理服务端口
    geminiProxy: 20090, // Gemini 代理服务端口
    opencodeProxy: 20091  // OpenCode 代理服务端口
  },
  maxLogs: 100,
  statsInterval: 30,
  modelDiscovery: {
    useV1ModelsEndpoint: false
  },
  defaultModels: modelMetadataConfig.defaultModels || { claude: [], codex: [], gemini: [] },
  defaultSpeedTestModels: modelMetadataConfig.defaultSpeedTestModels || {
    claude: 'claude-haiku-4-5',
    codex: 'gpt-5.4',
    gemini: 'gemini-2.5-pro'
  },
  pricing: {
    claude: {
      mode: 'auto',
      input: 3,
      output: 15,
      cacheCreation: 3.75,
      cacheRead: 0.30,
      models: {
        // All models use centralized pricing from src/config/model-pricing.js
        // Add custom entries here only if you need to override official pricing
      }
    },
    codex: {
      mode: 'auto',
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      models: {
        'gpt-5-codex': { mode: 'auto' },
        'gpt-4o-mini': { mode: 'auto' }
      }
    },
    gemini: {
      mode: 'auto',
      input: 1.25,
      output: 10,
      cacheRead: 0.125,
      models: {
        'gemini-2.5-pro': { mode: 'auto' },
        'gemini-2.5-flash': { mode: 'auto' }
      }
    },
    opencode: {
      mode: 'auto',
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      models: {}
    }
  }
};

module.exports = DEFAULT_CONFIG;
