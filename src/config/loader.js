// 配置加载和保存
const fs = require('fs');
const path = require('path');
const os = require('os');
const DEFAULT_CONFIG = require('./default');

const CONFIG_FILE = path.join(__dirname, '../../config.json');

/**
 * 展开 ~ 为用户主目录
 */
function expandHome(filepath) {
  if (filepath.startsWith('~')) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

/**
 * 加载配置
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const config = { ...DEFAULT_CONFIG, ...userConfig };
      config.projectsDir = expandHome(config.projectsDir);

      // 合并 ports 配置
      config.ports = { ...DEFAULT_CONFIG.ports, ...userConfig.ports };

      // 确保有 currentProject，使用 defaultProject 作为 currentProject
      if (!config.currentProject && config.defaultProject) {
        config.currentProject = config.defaultProject;
      }

      return config;
    }
  } catch (error) {
    console.error('加载配置文件失败，使用默认配置');
  }
  return { ...DEFAULT_CONFIG, currentProject: DEFAULT_CONFIG.defaultProject };
}

/**
 * 保存配置
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('保存配置失败:', error.message);
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  expandHome,
};
