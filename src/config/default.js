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
    geminiProxy: 20090  // Gemini 代理服务端口
  },
  maxLogs: 100,
  statsInterval: 30,
  pricing: {
    claude: {
      mode: 'auto',
      input: 3,
      output: 15,
      cacheCreation: 3.75,
      cacheRead: 0.30,
      models: {
        'claude-sonnet-4-20250514': { mode: 'auto' },
        'claude-haiku-3-5-20241022': {
          mode: 'custom',
          input: 0.8,
          output: 4,
          cacheCreation: 1,
          cacheRead: 0.08
        },
        'claude-opus-4-20250514': { mode: 'auto' }
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
    }
  }
};

module.exports = DEFAULT_CONFIG;
