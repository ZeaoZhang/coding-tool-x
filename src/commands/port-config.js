// 端口配置命令
const chalk = require('chalk');
const inquirer = require('inquirer');
const { loadConfig, saveConfig } = require('../config/loader');

/**
 * 配置端口
 */
async function handlePortConfig() {
  console.clear();
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          端口配置          ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════╝\n'));

  const config = loadConfig();

  console.log(chalk.cyan('当前端口配置:'));
  console.log(chalk.gray(`• Web UI 页面端口:  ${config.ports.webUI} (同时用于 WebSocket)`));
  console.log(chalk.gray(`• 代理服务端口:     ${config.ports.proxy}\n`));

  console.log(chalk.yellow('说明:'));
  console.log(chalk.gray('• 端口范围: 1024-65535'));
  console.log(chalk.gray('• 修改后需要重启相关服务才能生效'));
  console.log(chalk.gray('• 如果端口被占用，请修改为其他端口\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'webUI',
      message: 'Web UI 页面端口 (同时用于 WebSocket):',
      default: config.ports.webUI,
      validate: (input) => {
        const port = parseInt(input);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return '端口必须是 1024-65535 之间的数字';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'proxy',
      message: '代理服务端口:',
      default: config.ports.proxy,
      validate: (input) => {
        const port = parseInt(input);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return '端口必须是 1024-65535 之间的数字';
        }
        return true;
      },
    },
  ]);

  // 更新配置
  config.ports = {
    webUI: parseInt(answers.webUI),
    proxy: parseInt(answers.proxy),
  };

  // 保存配置
  saveConfig({
    projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
    defaultProject: config.defaultProject,
    maxDisplaySessions: config.maxDisplaySessions,
    pageSize: config.pageSize,
    ports: config.ports,
  });

  console.log(chalk.green('\n✅ 端口配置已保存\n'));
  console.log(chalk.yellow('⚠️  提示:'));
  console.log(chalk.gray('• 如果 Web UI 正在运行，请重启以使用新端口'));
  console.log(chalk.gray('• 如果动态切换已开启，请关闭后重新开启\n'));

  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: '按回车继续...',
    },
  ]);
}

module.exports = {
  handlePortConfig,
};
