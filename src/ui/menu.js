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
  console.log(chalk.gray(`当前项目: ${projectName}`));

  // 显示当前渠道和代理状态
  try {
    const { getCurrentChannel } = require('../server/services/channels');
    const { getProxyStatus } = require('../server/proxy-server');

    const currentChannel = getCurrentChannel();
    const proxyStatus = getProxyStatus();

    if (currentChannel) {
      console.log(chalk.gray(`当前渠道: ${currentChannel.name}`));
    }

    if (proxyStatus.running) {
      console.log(chalk.green(`动态切换: 已开启 (端口 ${proxyStatus.port})`));
    } else {
      console.log(chalk.gray('动态切换: 未开启'));
    }
  } catch (err) {
    // 忽略错误
  }

  console.log(chalk.gray('─'.repeat(50)));

  // 获取代理状态，用于显示动态切换的状态
  let proxyStatusText = '未开启';
  try {
    const { getProxyStatus } = require('../server/proxy-server');
    const proxyStatus = getProxyStatus();
    if (proxyStatus.running) {
      proxyStatusText = '已开启';
    }
  } catch (err) {
    // 忽略错误
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '请选择操作:',
      pageSize: 15,
      choices: [
        { name: chalk.cyan('列出最新对话'), value: 'list' },
        { name: chalk.green('搜索会话'), value: 'search' },
        { name: chalk.magenta('切换项目'), value: 'switch' },
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.cyan('切换渠道'), value: 'switch-channel' },
        { name: chalk.cyan(`是否开启动态切换 (${proxyStatusText})`), value: 'toggle-proxy' },
        { name: chalk.cyan('添加渠道'), value: 'add-channel' },
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.blueBright('启动 Web UI'), value: 'ui' },
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.magenta('配置端口'), value: 'port-config' },
        { name: chalk.yellow('恢复默认配置'), value: 'reset' },
        { name: chalk.gray('退出程序'), value: 'exit' },
      ],
    },
  ]);

  return action;
}

module.exports = {
  showMainMenu,
};
