// 菜单显示
const inquirer = require('inquirer');
const chalk = require('chalk');
const packageInfo = require('../../package.json');

function normalizeCliType(type) {
  if (type === 'claude' || type === 'codex' || type === 'gemini' || type === 'opencode') {
    return type;
  }
  return 'claude';
}

function pickActiveChannel(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return null;
  }
  return channels.find(channel => channel.enabled !== false) || channels[0];
}

function getChannelAndProxyStatus(cliType) {
  const currentType = normalizeCliType(cliType);

  if (currentType === 'claude') {
    const { getCurrentChannel } = require('../server/services/channels');
    const { getProxyStatus } = require('../server/proxy-server');
    return { channel: getCurrentChannel(), proxyStatus: getProxyStatus() };
  }

  if (currentType === 'codex') {
    const { getChannels } = require('../server/services/codex-channels');
    const { getCodexProxyStatus } = require('../server/codex-proxy-server');
    const data = getChannels();
    return { channel: pickActiveChannel(data?.channels), proxyStatus: getCodexProxyStatus() };
  }

  if (currentType === 'gemini') {
    const { getChannels } = require('../server/services/gemini-channels');
    const { getGeminiProxyStatus } = require('../server/gemini-proxy-server');
    const data = getChannels();
    return { channel: pickActiveChannel(data?.channels), proxyStatus: getGeminiProxyStatus() };
  }

  const { getChannels } = require('../server/services/opencode-channels');
  const { getOpenCodeProxyStatus } = require('../server/opencode-proxy-server');
  const data = getChannels();
  return { channel: pickActiveChannel(data?.channels), proxyStatus: getOpenCodeProxyStatus() };
}

/**
 * 显示主菜单
 */
async function showMainMenu(config) {
  console.log(chalk.bold.cyan('\n╔===============================================╗'));
  console.log(chalk.bold.cyan(`║    Claude Code 会话管理工具 v${packageInfo.version}          ║`));
  console.log(chalk.bold.cyan('╚===============================================╝\n'));

  // 显示当前CLI类型
  const cliTypes = {
    claude: { name: 'Claude Code', color: 'cyan' },
    codex: { name: 'Codex', color: 'green' },
    gemini: { name: 'Gemini', color: 'magenta' },
    opencode: { name: 'OpenCode', color: 'yellow' }
  };
  const currentType = normalizeCliType(config.currentCliType || 'claude');
  const typeInfo = cliTypes[currentType] || cliTypes.claude;
  console.log(chalk[typeInfo.color](`当前类型: ${typeInfo.name}`));

  const projectName = config.currentProject
    ? config.currentProject.replace(/-/g, '/').substring(1)
    : '未设置';
  console.log(chalk.gray(`当前项目: ${projectName}`));

  // 显示当前渠道和代理状态（根据类型显示对应的渠道和代理）
  try {
    const { channel: currentChannel, proxyStatus } = getChannelAndProxyStatus(currentType);

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

  // 获取代理状态，用于显示动态切换的状态（根据当前类型）
  let proxyStatusText = '未开启';
  try {
    const { proxyStatus } = getChannelAndProxyStatus(currentType);

    if (proxyStatus && proxyStatus.running) {
      proxyStatusText = '已开启';
    }
  } catch (err) {
    // 忽略错误
    console.error('获取代理状态失败:', err.message);
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '请选择操作:',
      pageSize: 16,
      choices: [
        { name: chalk.bold.yellow('切换 CLI 类型'), value: 'switch-cli-type' },
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.bold.hex('#00D9FF')('启动 Web UI'), value: 'ui' },
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.cyan('列出最新对话'), value: 'list' },
        { name: chalk.green('搜索会话'), value: 'search' },
        { name: chalk.magenta('切换项目'), value: 'switch' },
        { name: chalk.hex('#FF6B35')('工作区管理'), value: 'workspace' },
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.cyan('渠道管理'), value: 'switch-channel' },
        { name: chalk.cyan('查看调度状态'), value: 'channel-status' },
        { name: chalk.cyan(`是否开启动态切换 (${proxyStatusText})`), value: 'toggle-proxy' },
        { name: chalk.cyan('添加渠道'), value: 'add-channel' },
        { name: chalk.blue('插件管理'), value: 'plugin-menu' },
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
