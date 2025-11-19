// 默认配置
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG = {
  projectsDir: path.join(os.homedir(), '.claude', 'projects'),
  defaultProject: null,
  maxDisplaySessions: 20,
  pageSize: 15,
};

module.exports = DEFAULT_CONFIG;
