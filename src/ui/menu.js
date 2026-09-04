// 菜单显示
const inquirer = require('inquirer');
const chalk = require('chalk');
const packageInfo = require('../../package.json');

const { resolvePlatform, resolveOperation } = require('../platforms/access');

function getRuntimeDependencies(dependencies = {}) {
  const runtimeModule = require('../platforms/runtime');
  return {
    registry: dependencies.registry || runtimeModule.getPlatformRegistry(),
    runtime: dependencies.runtime || runtimeModule.getPlatformRuntime()
  };
}

function unwrapDriverResult(result) {
  if (!result || typeof result !== 'object' || !result.status) {
    return result;
  }
  if (result.status === 'ok') {
    return result.data;
  }
  throw result.cause instanceof Error
    ? result.cause
    : new Error(result.error || `Driver operation ${result.operation || 'unknown'} failed`);
}

function invokeOperation(platform, capability, operation, dependencies) {
  try {
    const resolved = resolveOperation(platform, capability, operation, dependencies);
    return {
      supported: true,
      value: unwrapDriverResult(resolved.operation())
    };
  } catch (error) {
    return { supported: false, error };
  }
}

function pickActiveChannel(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return null;
  }
  return channels.find(channel => channel.enabled !== false) || channels[0];
}

function getChannelAndProxyStatus(cliType, dependencies = {}) {
  const runtimeDependencies = getRuntimeDependencies(dependencies);
  let platform;
  try {
    platform = resolvePlatform(cliType || '', {
      ...runtimeDependencies,
      fallback: 'claude'
    });
  } catch (error) {
    return {
      platform: null,
      error,
      channel: null,
      proxyStatus: null,
      channelSupported: false,
      proxySupported: false
    };
  }

  const current = invokeOperation(platform.key, 'channels', 'current', runtimeDependencies);
  const listed = current.supported
    ? current
    : invokeOperation(platform.key, 'channels', 'list', runtimeDependencies);
  const channelValue = listed.value;
  const channel = Array.isArray(channelValue)
    ? pickActiveChannel(channelValue)
    : Array.isArray(channelValue?.channels)
      ? pickActiveChannel(channelValue.channels)
      : channelValue || null;
  const proxy = invokeOperation(platform.key, 'proxy', 'status', runtimeDependencies);

  return {
    platform,
    error: null,
    channel,
    proxyStatus: proxy.value || null,
    channelSupported: listed.supported,
    proxySupported: proxy.supported
  };
}

/**
 * 显示主菜单
 */
async function showMainMenu(config = {}, dependencies = {}) {
  console.log(chalk.bold.cyan('\n╔===============================================╗'));
  console.log(chalk.bold.cyan(`║    Claude Code 会话管理工具 v${packageInfo.version}          ║`));
  console.log(chalk.bold.cyan('╚===============================================╝\n'));

  const cliType = config.currentCliType || 'claude';
  const status = getChannelAndProxyStatus(cliType, dependencies);
  const manifest = status.platform?.manifest;
  const displayName = manifest?.label || manifest?.title || status.platform?.key || cliType;
  const terminalColor = manifest?.terminalColor;
  const colorize = typeof chalk[terminalColor] === 'function' ? chalk[terminalColor] : chalk.cyan;
  console.log(colorize(`当前类型: ${displayName}`));

  const projectName = config.currentProject
    ? config.currentProject.replace(/-/g, '/').substring(1)
    : '未设置';
  console.log(chalk.gray(`当前项目: ${projectName}`));

  if (status.channel) {
    console.log(chalk.gray(`当前渠道: ${status.channel.name}`));
  } else if (!status.channelSupported) {
    console.log(chalk.gray('当前渠道: 不可用'));
  }

  if (status.proxySupported && status.proxyStatus?.running) {
    console.log(chalk.green(`动态切换: 已开启 (端口 ${status.proxyStatus.port})`));
  } else if (status.proxySupported) {
    console.log(chalk.gray('动态切换: 未开启'));
  } else {
    console.log(chalk.gray('动态切换: 不可用'));
  }

  console.log(chalk.gray('─'.repeat(50)));

  const proxyStatusText = !status.proxySupported
    ? '不可用'
    : status.proxyStatus?.running ? '已开启' : '未开启';

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
