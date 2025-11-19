// 切换项目命令
const chalk = require('chalk');
const { getAvailableProjects } = require('../utils/session');
const { promptSelectProject } = require('../ui/prompts');
const { saveConfig } = require('../config/loader');

/**
 * 切换项目
 */
async function switchProject(config) {
  const projects = getAvailableProjects(config);

  if (projects.length === 0) {
    console.log(chalk.yellow('没有找到项目'));
    return false;
  }

  const selectedProject = await promptSelectProject(projects);

  // 更新配置
  config.currentProject = selectedProject;

  // 保存到配置文件
  saveConfig({
    projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
    defaultProject: selectedProject,
    maxDisplaySessions: config.maxDisplaySessions,
    pageSize: config.pageSize,
  });

  console.log(chalk.green(`\n✅ 已切换到: ${selectedProject.replace(/-/g, '/').substring(1)}\n`));
  return true;
}

module.exports = {
  switchProject,
};
