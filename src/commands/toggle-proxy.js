// 动态切换开关命令
const chalk = require('chalk');
const inquirer = require('inquirer');
const { loadConfig } = require('../config/loader');
const SETTINGS_MANAGERS = {
  claude: () => require('../server/services/settings-manager'),
  codex: () => require('../server/services/codex-settings-manager'),
  gemini: () => require('../server/services/gemini-settings-manager')
};

/**
 * 获取当前类型的代理服务
 */
function getProxyServices(cliType) {
  if (cliType === 'claude') {
    const { getProxyStatus, startProxyServer, stopProxyServer } = require('../server/proxy-server');
    return { getProxyStatus, startProxyServer, stopProxyServer, defaultPort: 10088 };
  } else if (cliType === 'codex') {
    const { getCodexProxyStatus, startCodexProxyServer, stopCodexProxyServer } = require('../server/codex-proxy-server');
    return {
      getProxyStatus: getCodexProxyStatus,
      startProxyServer: startCodexProxyServer,
      stopProxyServer: stopCodexProxyServer,
      defaultPort: 10089
    };
  } else if (cliType === 'gemini') {
    const { getGeminiProxyStatus, startGeminiProxyServer, stopGeminiProxyServer } = require('../server/gemini-proxy-server');
    return {
      getProxyStatus: getGeminiProxyStatus,
      startProxyServer: startGeminiProxyServer,
      stopProxyServer: stopGeminiProxyServer,
      defaultPort: 10090
    };
  }
}

function getSettingsManager(cliType) {
  const loader = SETTINGS_MANAGERS[cliType] || SETTINGS_MANAGERS.claude;
  const manager = loader();
  return {
    setProxyConfig: manager.setProxyConfig,
    restoreSettings: manager.restoreSettings,
    hasBackup: manager.hasBackup
  };
}

/**
 * 切换动态切换功能
 */
async function handleToggleProxy() {
  const config = loadConfig();
  const cliType = config.currentCliType || 'claude';
  const services = getProxyServices(cliType);

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
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║        开启动态切换        ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════╝\n'));

  const toolName = cliType === 'claude' ? 'Claude Code' : (cliType === 'codex' ? 'Codex' : 'Gemini');
  const defaultPort = services.defaultPort;

  console.log(chalk.cyan('动态切换功能说明:'));
  console.log(chalk.gray('• 开启后会在本地启动一个代理服务'));
  console.log(chalk.gray(`• 可以在不重启 ${toolName} 的情况下动态管理渠道`));
  console.log(chalk.gray('• 通过 Web UI 或"渠道管理"功能快速调整启用的线路'));
  console.log(chalk.gray(`• 代理服务地址: http://127.0.0.1:${defaultPort}\n`));

  console.log(chalk.yellow('⚠️  重要提示:'));
  console.log(chalk.yellow('• 开启期间请勿关闭 CLI 终端窗口'));
  console.log(chalk.yellow('• 如果异常关闭导致代理失效，请运行: ct reset'));
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
    console.log(chalk.cyan('\n🚀 正在启动代理服务...\n'));

    // 启动代理服务器
    const proxyResult = await services.startProxyServer();

    if (!proxyResult.success) {
      throw new Error('代理服务器启动失败');
    }

    console.log(chalk.green(`✅ 代理服务已启动: http://127.0.0.1:${proxyResult.port}`));

    // 修改配置文件
    const settingsManager = getSettingsManager(cliType);
    settingsManager.setProxyConfig(proxyResult.port);
    console.log(chalk.green('✅ 配置文件已更新'));

    if (settingsManager.hasBackup()) {
      console.log(chalk.green('✅ 原配置已备份'));
    }

    console.log(chalk.cyan('\n💡 动态切换已启用！'));
    console.log(chalk.gray(`   现在可以通过"渠道管理"功能快速调整，无需重启 ${toolName}\n`));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  } catch (error) {
    console.log(chalk.red(`\n❌ 启动失败: ${error.message}\n`));

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
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║        关闭动态切换        ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════╝\n'));

  const toolName = cliType === 'claude' ? 'Claude Code' : (cliType === 'codex' ? 'Codex' : 'Gemini');
  const proxyStatus = services.getProxyStatus();

  console.log(chalk.cyan('当前状态:'));
  console.log(chalk.gray(`• 代理服务: ${chalk.green('运行中')}`));
  console.log(chalk.gray(`• 代理端口: ${proxyStatus.port}`));
  console.log(chalk.gray(`• 代理地址: http://127.0.0.1:${proxyStatus.port}\n`));

  console.log(chalk.yellow('关闭后:'));
  console.log(chalk.gray('• 代理服务将被停止'));
  console.log(chalk.gray('• 配置将恢复到关闭前的状态'));
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
    console.log(chalk.cyan('\n⏹️  正在停止代理服务...\n'));

    // 停止代理服务器
    await services.stopProxyServer();
    console.log(chalk.green('✅ 代理服务已停止'));

    // 恢复配置文件
    const settingsManager = getSettingsManager(cliType);
    if (settingsManager.hasBackup()) {
      settingsManager.restoreSettings();
      console.log(chalk.green('✅ 配置文件已恢复'));
    }

    console.log(chalk.cyan('\n💡 动态切换已关闭'));
    console.log(chalk.gray(`   现在调整渠道需要重启 ${toolName} 才能生效\n`));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  } catch (error) {
    console.log(chalk.red(`\n❌ 停止失败: ${error.message}\n`));

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
