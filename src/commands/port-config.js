// 端口配置命令
const chalk = require('chalk');
const inquirer = require('inquirer');
const { loadConfig, saveConfig } = require('../config/loader');

function normalizePort(value) {
  return parseInt(value, 10);
}

function validatePort(input) {
  const port = normalizePort(input);
  if (isNaN(port) || port < 1024 || port > 65535) {
    return '端口必须是 1024-65535 之间的数字';
  }
  return true;
}

function getPlatformPortDefinitions() {
  const { createPlatformCommandRegistry } = require('./platform-command-registry');
  return createPlatformCommandRegistry().list()
    .filter(platform => platform.portKey && Number.isInteger(platform.defaultPort) && platform.defaultPort > 0);
}

function buildPortQuestions(config = {}, platformDefinitions = getPlatformPortDefinitions()) {
  const ports = config.ports || {};
  const questions = [
    {
      type: 'input',
      name: 'webUI',
      message: 'Web UI 页面端口 (同时用于 WebSocket):',
      default: ports.webUI || 19999,
      validate: validatePort,
    }
  ];

  for (const platform of platformDefinitions) {
    questions.push({
      type: 'input',
      name: platform.portKey,
      message: platform.portLabel || `${platform.label || platform.key} 代理服务端口:`,
      default: ports[platform.portKey] || platform.defaultPort,
      validate: validatePort
    });
  }

  return questions;
}

function buildPortsConfig(answers = {}, platformDefinitions = getPlatformPortDefinitions()) {
  const ports = { webUI: normalizePort(answers.webUI) };
  for (const platform of platformDefinitions) {
    ports[platform.portKey] = normalizePort(answers[platform.portKey]);
  }
  return ports;
}

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
  const ports = config.ports || {};

  const platformDefinitions = getPlatformPortDefinitions();
  console.log(chalk.cyan('当前端口配置:'));
  console.log(chalk.gray(`• Web UI 页面端口:     ${ports.webUI || 19999} (同时用于 WebSocket)`));
  for (const platform of platformDefinitions) {
    const label = platform.label || platform.key;
    console.log(chalk.gray(`• ${label} 端口:     ${ports[platform.portKey] || platform.defaultPort}`));
  }
  console.log('');

  console.log(chalk.yellow('说明:'));
  console.log(chalk.gray('• 端口范围: 1024-65535'));
  console.log(chalk.gray('• 修改后需要重启相关服务才能生效'));
  console.log(chalk.gray('• 如果端口被占用，请修改为其他端口\n'));

  const answers = await inquirer.prompt(buildPortQuestions(config));

  // 更新配置
  config.ports = buildPortsConfig(answers);

  // 保存配置（保留其余字段）
  saveConfig({
    ...config,
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
  _test: {
    buildPortQuestions,
    buildPortsConfig,
    getPlatformPortDefinitions,
    validatePort
  }
};
