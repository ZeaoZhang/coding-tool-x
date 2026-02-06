// 默认配置
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  projectsDir: path.join(os.homedir(), '.claude', 'projects'),
  defaultProject: null,
  maxDisplaySessions: 100,
  pageSize: 15,
  currentCliType: 'claude',  // 当前CLI工具类型: claude, codex, gemini
  ports: {
    webUI: 19999,       // Web UI 页面端口 (同时用于 WebSocket)
    proxy: 20088,       // Claude 代理服务端口
    codexProxy: 20089,  // Codex 代理服务端口
    geminiProxy: 20090, // Gemini 代理服务端口
    opencodeProxy: 20091  // OpenCode 代理服务端口
  },
  maxLogs: 100,
  statsInterval: 30,
  defaultModels: {
    claude: [
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514'
    ],
    codex: [
      'gpt-5.2-codex',
      'gpt-5.1-codex-max',
      'gpt-5.1-codex-mini',
      'gpt-5.1-codex',
      'gpt-5-codex',
      'gpt-5.2',
      'gpt-5.1',
      'gpt-5'
    ],
    gemini: [
      'gemini-3-pro',
      'gemini-3-flash',
      'gemini-3-deep-think',
      'gemini-2.5-pro',
      'gemini-2.5-flash'
    ],
    opencode: [
      'gpt-4o',
      'gpt-4o-mini',
      'claude-3-5-sonnet',
      'claude-3-opus',
      'deepseek-chat'
    ]
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
      output: 10,
      models: {
        'gpt-5-codex': { mode: 'auto' },
        'gpt-4o-mini': { mode: 'auto' }
      }
    },
    gemini: {
      mode: 'auto',
      input: 1.25,
      output: 5,
      models: {
        'gemini-2.5-pro': { mode: 'auto' },
        'gemini-2.5-flash': { mode: 'auto' }
      }
    },
    opencode: {
      mode: 'auto',
      input: 2.5,
      output: 10,
      models: {}
    }
  }
};

module.exports = DEFAULT_CONFIG;
