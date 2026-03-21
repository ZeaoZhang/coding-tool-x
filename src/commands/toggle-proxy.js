// 动态切换开关命令
const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { loadConfig } = require('../config/loader');
const { PATHS } = require('../config/paths');
const { clearNativeOAuth } = require('../server/services/native-oauth-adapters');
const SETTINGS_MANAGERS = {
  claude: () => require('../server/services/settings-manager'),
  codex: () => require('../server/services/codex-settings-manager'),
  gemini: () => require('../server/services/gemini-settings-manager'),
  opencode: () => require('../server/services/opencode-settings-manager')
};

/**
 * 获取当前类型的代理服务
 */
function getProxyServices(cliType) {
  if (cliType === 'claude') {
    const { getProxyStatus, startProxyServer, stopProxyServer } = require('../server/proxy-server');
    return { getProxyStatus, startProxyServer, stopProxyServer, defaultPort: 20088 };
  } else if (cliType === 'codex') {
    const { getCodexProxyStatus, startCodexProxyServer, stopCodexProxyServer } = require('../server/codex-proxy-server');
    return {
      getProxyStatus: getCodexProxyStatus,
      startProxyServer: startCodexProxyServer,
      stopProxyServer: stopCodexProxyServer,
      defaultPort: 20089
    };
  } else if (cliType === 'gemini') {
    const { getGeminiProxyStatus, startGeminiProxyServer, stopGeminiProxyServer } = require('../server/gemini-proxy-server');
    return {
      getProxyStatus: getGeminiProxyStatus,
      startProxyServer: startGeminiProxyServer,
      stopProxyServer: stopGeminiProxyServer,
      defaultPort: 20090
    };
  } else if (cliType === 'opencode') {
    const { getOpenCodeProxyStatus, startOpenCodeProxyServer, stopOpenCodeProxyServer } = require('../server/opencode-proxy-server');
    return {
      getProxyStatus: getOpenCodeProxyStatus,
      startProxyServer: startOpenCodeProxyServer,
      stopProxyServer: stopOpenCodeProxyServer,
      defaultPort: 20091
    };
  }
}

function getSettingsManager(cliType) {
  const loader = SETTINGS_MANAGERS[cliType] || SETTINGS_MANAGERS.claude;
  const manager = loader();
  return {
    setProxyConfig: manager.setProxyConfig,
    restoreSettings: manager.restoreSettings,
    hasBackup: manager.hasBackup,
    deleteBackup: manager.deleteBackup
  };
}

function removeActiveChannelMarker(cliType) {
  const markerPath = PATHS.activeChannel?.[cliType];
  if (!markerPath) {
    return;
  }

  try {
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
    }
  } catch {
    // ignore cleanup failures
  }
}

function loadActiveChannelId(cliType) {
  const markerPath = PATHS.activeChannel?.[cliType];
  if (!markerPath) {
    return null;
  }

  try {
    if (!fs.existsSync(markerPath)) {
      return null;
    }
    const payload = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return payload?.activeChannelId || null;
  } catch {
    return null;
  }
}

function pickLatestEnabledChannel(channels = []) {
  const enabledChannels = Array.isArray(channels)
    ? channels.filter(channel => channel?.enabled !== false)
    : [];

  if (enabledChannels.length > 0) {
    return enabledChannels[0];
  }

  return Array.isArray(channels) ? channels[0] || null : null;
}

function pickRestoredChannel(cliType, channels = []) {
  const activeChannelId = loadActiveChannelId(cliType);
  if (activeChannelId) {
    const matchedChannel = Array.isArray(channels)
      ? channels.find(channel => channel?.id === activeChannelId)
      : null;
    if (matchedChannel) {
      return matchedChannel;
    }
  }

  return pickLatestEnabledChannel(channels);
}

function restoreSingleChannelMode(cliType) {
  if (cliType === 'claude') {
    const { getAllChannels, applyChannelToSettings } = require('../server/services/channels');
    const target = pickRestoredChannel(cliType, getAllChannels());
    return target ? applyChannelToSettings(target.id) : null;
  }

  if (cliType === 'codex') {
    const { getChannels, applyChannelToSettings } = require('../server/services/codex-channels');
    const target = pickRestoredChannel(cliType, getChannels().channels || []);
    return target ? applyChannelToSettings(target.id) : null;
  }

  if (cliType === 'gemini') {
    const { getChannels, applyChannelToSettings } = require('../server/services/gemini-channels');
    const target = pickRestoredChannel(cliType, getChannels().channels || []);
    return target ? applyChannelToSettings(target.id) : null;
  }

  if (cliType === 'opencode') {
    const { getChannels, applyChannelToSettings } = require('../server/services/opencode-channels');
    const target = pickRestoredChannel(cliType, getChannels().channels || []);
    return target ? applyChannelToSettings(target.id) : null;
  }

  return null;
}

/**
 * 切换动态切换功能
 */
async function handleToggleProxy() {
  const config = loadConfig();
  const cliType = config.currentCliType || 'claude';
  const services = getProxyServices(cliType);
  if (!services) {
    console.log(chalk.red(`\n[ERROR] 当前 CLI 类型 (${cliType}) 暂不支持动态切换\n`));
    return;
  }

  const proxyStatus = services.getProxyStatus();

  if (proxyStatus.running) {
    // 当前代理正在运行，提示关闭
    await handleStopProxy(cliType, services);
  } else {
    // 当前代理未运行，提示开启
    await handleStartProxy(cliType, services);
  }
}

/**
 * 开启动态切换
 */
async function handleStartProxy(cliType, services) {
  console.clear();
  console.log(chalk.bold.cyan('\n╔=======================================╗'));
  console.log(chalk.bold.cyan('║        开启动态切换        ║'));
  console.log(chalk.bold.cyan('╚=======================================╝\n'));

  const toolNameMap = {
    claude: 'Claude Code',
    codex: 'Codex',
    gemini: 'Gemini',
    opencode: 'OpenCode'
  };
  const toolName = toolNameMap[cliType] || 'Claude Code';
  const defaultPort = services.defaultPort;

  console.log(chalk.cyan('动态切换功能说明:'));
  console.log(chalk.gray('• 开启后会在本地启动一个代理服务'));
  console.log(chalk.gray(`• 可以在不重启 ${toolName} 的情况下动态管理渠道`));
  console.log(chalk.gray('• 通过 Web UI 或"渠道管理"功能快速调整启用的线路'));
  console.log(chalk.gray(`• 代理服务地址: http://127.0.0.1:${defaultPort}\n`));

  console.log(chalk.yellow('[WARN]  重要提示:'));
  console.log(chalk.yellow('• 开启期间请勿关闭 CLI 终端窗口'));
  console.log(chalk.yellow('• 如果异常关闭导致代理失效，请运行: ctx reset'));
  console.log(chalk.yellow('• 或使用主菜单的"恢复默认配置"功能\n'));

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: '是否开启动态切换？',
      default: true,
    },
  ]);

  if (!confirm) {
    console.log(chalk.gray('\n已取消\n'));
    return;
  }

  try {
    console.log(chalk.cyan('\n[START] 正在启动代理服务...\n'));

    // 启动代理服务器
    const proxyResult = await services.startProxyServer();

    if (!proxyResult.success) {
      throw new Error('代理服务器启动失败');
    }

    console.log(chalk.green(`[OK] 代理服务已启动: http://127.0.0.1:${proxyResult.port}`));

    // 修改配置文件
    const settingsManager = getSettingsManager(cliType);
    clearNativeOAuth(cliType);
    settingsManager.setProxyConfig(proxyResult.port);
    console.log(chalk.green('[OK] 配置文件已更新'));

    if (settingsManager.hasBackup()) {
      console.log(chalk.green('[OK] 原配置已备份'));
    }

    console.log(chalk.cyan('\n[TIP] 动态切换已启用！'));
    console.log(chalk.gray(`   现在可以通过"渠道管理"功能快速调整，无需重启 ${toolName}\n`));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  } catch (error) {
    console.log(chalk.red(`\n[ERROR] 启动失败: ${error.message}\n`));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  }
}

/**
 * 关闭动态切换
 */
async function handleStopProxy(cliType, services) {
  console.clear();
  console.log(chalk.bold.cyan('\n╔=======================================╗'));
  console.log(chalk.bold.cyan('║        关闭动态切换        ║'));
  console.log(chalk.bold.cyan('╚=======================================╝\n'));

  const toolNameMap = {
    claude: 'Claude Code',
    codex: 'Codex',
    gemini: 'Gemini',
    opencode: 'OpenCode'
  };
  const toolName = toolNameMap[cliType] || 'Claude Code';
  const proxyStatus = services.getProxyStatus();

  console.log(chalk.cyan('当前状态:'));
  console.log(chalk.gray(`• 代理服务: ${chalk.green('运行中')}`));
  console.log(chalk.gray(`• 代理端口: ${proxyStatus.port}`));
  console.log(chalk.gray(`• 代理地址: http://127.0.0.1:${proxyStatus.port}\n`));

  console.log(chalk.yellow('关闭后:'));
  console.log(chalk.gray('• 代理服务将被停止'));
  console.log(chalk.gray('• 配置将恢复为当前激活渠道的单渠道模式'));
  console.log(chalk.gray(`• 之后管理渠道将需要重启 ${toolName}\n`));

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: '是否关闭动态切换？',
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.gray('\n已取消\n'));
    return;
  }

  try {
    console.log(chalk.cyan('\n[STOP]  正在停止代理服务...\n'));

    // 停止代理服务器
    await services.stopProxyServer();
    console.log(chalk.green('[OK] 代理服务已停止'));

    // 恢复配置文件
    const settingsManager = getSettingsManager(cliType);
    settingsManager.deleteBackup?.();
    const restoredChannel = restoreSingleChannelMode(cliType);
    removeActiveChannelMarker(cliType);
    if (restoredChannel?.name) {
      console.log(chalk.green(`[OK] 已恢复到渠道: ${restoredChannel.name}`));
    } else {
      console.log(chalk.green('[OK] 已清理代理接管状态'));
    }

    console.log(chalk.cyan('\n[TIP] 动态切换已关闭'));
    console.log(chalk.gray(`   现在调整渠道需要重启 ${toolName} 才能生效\n`));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  } catch (error) {
    console.log(chalk.red(`\n[ERROR] 停止失败: ${error.message}\n`));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  }
}

module.exports = {
  handleToggleProxy,
};
