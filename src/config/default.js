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
    webUI: 10099,       // Web UI 页面端口 (同时用于 WebSocket)
    proxy: 10088,       // Claude 代理服务端口
    codexProxy: 10089,  // Codex 代理服务端口
    geminiProxy: 10090  // Gemini 代理服务端口
  },
  maxLogs: 100,
  statsInterval: 30,
  pricing: {
    claude: {
      mode: 'auto',
      input: 3,
      output: 15,
      cacheCreation: 3.75,
      cacheRead: 0.30
    },
    codex: {
      mode: 'auto',
      input: 2.5,
      output: 10
    },
    gemini: {
      mode: 'auto',
      input: 1.25,
      output: 5
    }
  }
};

module.exports = DEFAULT_CONFIG;
