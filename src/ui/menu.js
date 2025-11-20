// 菜单显示
const inquirer = require('inquirer');
const chalk = require('chalk');
const packageInfo = require('../../package.json');

/**
 * 显示主菜单
 */
async function showMainMenu(config) {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan(`║    Claude Code 会话管理工具 v${packageInfo.version}          ║`));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════╝\n'));

  const projectName = config.currentProject
    ? config.currentProject.replace(/-/g, '/').substring(1)
    : '未设置';
  console.log(chalk.gray(`📂 当前项目: ${projectName}`));
  console.log(chalk.gray('─'.repeat(50)));

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '请选择操作:',
      pageSize: 10,
      choices: [
        { name: chalk.blue('💼  列出最近的会话'), value: 'list' },
        { name: chalk.blue('🔎  搜索会话'), value: 'search' },
        { name: chalk.blue('🔀  切换项目'), value: 'switch' },
        { name: chalk.blue('🌐  启动 Web UI'), value: 'ui' },
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.gray('👋  退出程序'), value: 'exit' },
      ],
    },
  ]);

  return action;
}

module.exports = {
  showMainMenu,
};
