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

  // 用户取消切换
  if (!selectedProject) {
    console.log(chalk.gray('\n取消切换\n'));
    return false;
  }

  // 更新配置
  config.currentProject = selectedProject;

  // 保存到配置文件
  saveConfig({
    projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
    defaultProject: selectedProject,
    maxDisplaySessions: config.maxDisplaySessions,
    pageSize: config.pageSize,
  });

  // 使用解析后的名称显示
  const { parseRealProjectPath } = require('../server/services/sessions');
  const { displayName, fullPath } = parseRealProjectPath(selectedProject);

  console.log(chalk.green(`\n✅ 已切换到: ${displayName}\n`));
  console.log(chalk.gray(`   路径: ${fullPath}\n`));
  return true;
}

module.exports = {
  switchProject,
};
