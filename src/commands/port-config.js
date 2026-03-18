// 端口配置命令
const chalk = require('chalk');
const inquirer = require('inquirer');
const { loadConfig, saveConfig } = require('../config/loader');
const { HOME_DIR } = require('../config/paths');

/**
 * 配置端口
 */
async function handlePortConfig() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(chalk.yellow('\n当前环境不支持交互式端口配置，请在本地终端中运行 `ctx port`。\n'));
    return;
  }

  console.clear();
  console.log(chalk.bold.cyan('\n╔=======================================╗'));
  console.log(chalk.bold.cyan('║          端口配置          ║'));
  console.log(chalk.bold.cyan('╚=======================================╝\n'));

  const config = loadConfig();

  console.log(chalk.cyan('当前端口配置:'));
  console.log(chalk.gray(`• Web UI 页面端口:     ${config.ports.webUI} (同时用于 WebSocket)`));
  console.log(chalk.gray(`• Claude 代理端口:     ${config.ports.proxy}`));
  console.log(chalk.gray(`• Codex 代理端口:      ${config.ports.codexProxy || 20089}`));
  console.log(chalk.gray(`• Gemini 代理端口:     ${config.ports.geminiProxy || 20090}`));
  console.log(chalk.gray(`• OpenCode 代理端口:   ${config.ports.opencodeProxy || 20091}\n`));

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
      message: 'Claude 代理服务端口:',
      default: config.ports.proxy,
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
      name: 'codexProxy',
      message: 'Codex 代理服务端口:',
      default: config.ports.codexProxy || 20089,
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
      name: 'geminiProxy',
      message: 'Gemini 代理服务端口:',
      default: config.ports.geminiProxy || 20090,
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
      name: 'opencodeProxy',
      message: 'OpenCode 代理服务端口:',
      default: config.ports.opencodeProxy || 20091,
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
    codexProxy: parseInt(answers.codexProxy),
    geminiProxy: parseInt(answers.geminiProxy),
    opencodeProxy: parseInt(answers.opencodeProxy),
  };

  // 保存配置（保留其余字段）
  saveConfig({
    ...config,
    projectsDir: config.projectsDir.replace(HOME_DIR, '~'),
    ports: config.ports,
  });

  console.log(chalk.green('\n[OK] 端口配置已保存\n'));
  console.log(chalk.yellow('[WARN]  提示:'));
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
