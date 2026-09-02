// 动态切换开关命令
const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { loadConfig } = require('../config/loader');
const { PATHS } = require('../config/paths');
const { normalizePlatformKey } = require('../shared/platforms');
const { getPlatformRuntime, getPlatformRegistry } = require('../platforms/runtime');

/**
 * 获取当前类型的代理服务
 */
function unwrapDriverResult(result) {
  if (!result || typeof result !== 'object' || !result.status) return result;
  if (result.status === 'ok') return result.data;
  throw result.cause instanceof Error
    ? result.cause
    : new Error(result.error || `Driver operation ${result.operation || 'unknown'} failed`);
}

function getProxyServices(cliType, runtime = getPlatformRuntime()) {
  const platform = normalizePlatformKey(cliType || 'claude');
  const proxyDriver = runtime?.getDriver?.(platform, 'proxy');
  const channelsDriver = runtime?.getDriver?.(platform, 'channels');
  if (!proxyDriver) return null;

  const metadata = {
    ...(channelsDriver?.getCliMetadata?.() || {}),
    ...(proxyDriver.getCliMetadata?.() || {})
  };
  return {
    ...metadata,
    getProxyStatus: () => unwrapDriverResult(proxyDriver.status()),
    startProxyServer: options => unwrapDriverResult(proxyDriver.start(options)),
    stopProxyServer: options => unwrapDriverResult(proxyDriver.stop(options)),
    getAllChannels: () => {
      if (typeof channelsDriver?.list !== 'function') return [];
      const result = unwrapDriverResult(channelsDriver.list());
      return Array.isArray(result) ? result : (result?.channels || []);
    },
    applyChannelToSettings: id => channelsDriver?.applyNativeConfig
      ? unwrapDriverResult(channelsDriver.applyNativeConfig(id))
      : null,
    channelsDriver,
    proxyDriver
  };
}
function getPlatformLabel(platform) {
  return getPlatformRegistry().resolve(platform)?.label || platform;
}


function getSettingsManager(cliType, runtime = getPlatformRuntime()) {
  const platform = normalizePlatformKey(cliType || 'claude');
  const driver = runtime?.getDriver?.(platform, 'nativeConfig');
  if (!driver || typeof driver.setProxyConfig !== 'function') {
    return null;
  }

  return {
    setProxyConfig: (...args) => unwrapDriverResult(driver.setProxyConfig(...args)),
    restoreSettings: typeof driver.restoreSettings === 'function'
      ? (...args) => unwrapDriverResult(driver.restoreSettings(...args))
      : undefined,
    isProxyConfig: typeof driver.isProxyConfig === 'function'
      ? (...args) => unwrapDriverResult(driver.isProxyConfig(...args))
      : undefined,
    hasBackup: typeof driver.hasBackup === 'function'
      ? (...args) => unwrapDriverResult(driver.hasBackup(...args))
      : () => false,
    deleteBackup: typeof driver.deleteBackup === 'function'
      ? (...args) => unwrapDriverResult(driver.deleteBackup(...args))
      : undefined,
    clearNativeOAuth: typeof driver.clearNativeOAuth === 'function'
      ? (...args) => unwrapDriverResult(driver.clearNativeOAuth(...args))
      : undefined
  };
}

function removeActiveChannelMarker(cliType) {
  const normalizedCliType = normalizePlatformKey(cliType || 'claude');
  const markerPath = PATHS.activeChannel?.[normalizedCliType];
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
  const normalizedCliType = normalizePlatformKey(cliType || 'claude');
  const markerPath = PATHS.activeChannel?.[normalizedCliType];
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

function restoreSingleChannelMode(cliType, runtime = getPlatformRuntime()) {
  const platform = normalizePlatformKey(cliType || 'claude');
  const channelsDriver = runtime?.getDriver?.(platform, 'channels');
  if (!channelsDriver || typeof channelsDriver.list !== 'function') {
    return null;
  }

  const listed = unwrapDriverResult(channelsDriver.list());
  const channels = Array.isArray(listed) ? listed : (listed?.channels || []);
  const target = pickRestoredChannel(platform, channels);
  if (!target) return null;

  const result = typeof channelsDriver.applyNativeConfig === 'function'
    ? channelsDriver.applyNativeConfig(target.id)
    : channelsDriver.applyChannelToSettings?.(target.id);
  return unwrapDriverResult(result);
}

/**
 * 切换动态切换功能
 */
async function handleToggleProxy() {
  const config = loadConfig();
  const cliType = normalizePlatformKey(config.currentCliType || 'claude');
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
  const toolName = getPlatformLabel(cliType);
  const defaultPort = services.defaultPort;

  console.log(chalk.cyan('动态切换功能说明:'));
  if (services.managedProviderConfig) {
    console.log(chalk.gray('• 开启后会启动 OMP 专用本地网关，并把受管 provider 指向该网关'));
    console.log(chalk.gray(`• 可以通过 Web UI 或"渠道管理"功能调整启用的 ${toolName} 路由组`));
    console.log(chalk.gray('• 同路由组内由 coding-tool-x 动态选择渠道，跨模型 fallback 仍由 OMP 处理'));
    console.log(chalk.gray(`• OMP 网关地址: http://127.0.0.1:${defaultPort}\n`));
  } else {
    console.log(chalk.gray('• 开启后会在本地启动一个代理服务'));
    console.log(chalk.gray(`• 可以在不重启 ${toolName} 的情况下动态管理渠道`));
    console.log(chalk.gray('• 通过 Web UI 或"渠道管理"功能快速调整启用的线路'));
    console.log(chalk.gray(`• 代理服务地址: http://127.0.0.1:${defaultPort}\n`));
  }

  console.log(chalk.yellow('[WARN]  重要提示:'));
  if (services.managedProviderConfig) {
    console.log(chalk.yellow('• 启用后会写入指向本地网关的 OMP models.yml provider 配置'));
    console.log(chalk.yellow('• 关闭后会保留当前渠道的直连 provider，不会清理 OMP 原生 auth.json\n'));
  } else {
    console.log(chalk.yellow('• 开启期间请勿关闭 CLI 终端窗口'));
    console.log(chalk.yellow('• 如果异常关闭导致代理失效，请运行: ctx reset'));
    console.log(chalk.yellow('• 或使用主菜单的"恢复默认配置"功能\n'));
  }

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
    console.log(chalk.cyan(services.managedProviderConfig
      ? '\n[START] 正在启用 OMP models.yml 受管 provider...\n'
      : '\n[START] 正在启动代理服务...\n'));

    // 启动代理服务器
    const proxyResult = await services.startProxyServer();

    if (!proxyResult.success) {
      throw new Error(services.managedProviderConfig ? 'OMP 受管 provider 启用失败' : '代理服务器启动失败');
    }

    if (services.managedProviderConfig) {
      console.log(chalk.green('[OK] OMP models.yml 受管 provider 已启用'));
      console.log(chalk.gray('OMP 新增会话用量日志观察已启用'));
      (proxyResult.warnings || []).forEach((warning) => {
        console.log(chalk.yellow(`[WARN]  ${warning}`));
      });
    } else {
      console.log(chalk.green(`[OK] 代理服务已启动: http://127.0.0.1:${proxyResult.port}`));
    }

    // 修改配置文件
    if (!services.managedProviderConfig) {
      const settingsManager = getSettingsManager(cliType);
      if (!settingsManager) {
        throw new Error(`平台 ${cliType} 未提供 nativeConfig 能力`);
      }
      settingsManager.clearNativeOAuth?.(cliType);
      settingsManager.setProxyConfig(proxyResult.port);
      console.log(chalk.green('[OK] 配置文件已更新'));

      if (settingsManager.hasBackup()) {
        console.log(chalk.green('[OK] 原配置已备份'));
      }
    }

    console.log(chalk.cyan(services.managedProviderConfig ? '\n[TIP] OMP 动态切换已启用！' : '\n[TIP] 动态切换已启用！'));
    if (services.managedProviderConfig) {
      console.log(chalk.gray('   现在可以通过"渠道管理"功能调整已启用的 OMP provider，并重新同步 models.yml\n'));
    } else {
      console.log(chalk.gray(`   现在可以通过"渠道管理"功能快速调整，无需重启 ${toolName}\n`));
    }

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

  const toolName = getPlatformLabel(cliType);
  const proxyStatus = services.getProxyStatus();

  console.log(chalk.cyan('当前状态:'));
  if (services.managedProviderConfig) {
    console.log(chalk.gray(`• 动态切换: ${chalk.green('已启用')}`));
    console.log(chalk.gray(`• 配置模式: ${proxyStatus.mode || 'models-yml-provider-config'}`));
    console.log(chalk.gray(`• 会话日志观察: ${proxyStatus.sessionLogObserver?.running ? chalk.green('运行中') : chalk.yellow('未运行')}\n`));
  } else {
    console.log(chalk.gray(`• 代理服务: ${chalk.green('运行中')}`));
    console.log(chalk.gray(`• 代理端口: ${proxyStatus.port}`));
    console.log(chalk.gray(`• 代理地址: http://127.0.0.1:${proxyStatus.port}\n`));
  }

  console.log(chalk.yellow('关闭后:'));
  if (services.managedProviderConfig) {
    console.log(chalk.gray('• OMP 将保留当前渠道的单一、直连 models.yml provider'));
    console.log(chalk.gray(`• 之后调整 ${toolName} provider 或模型会立即同步到 OMP\n`));
  } else {
    console.log(chalk.gray('• 代理服务将被停止'));
    console.log(chalk.gray('• 配置将恢复为当前激活渠道的单渠道模式'));
    console.log(chalk.gray(`• 之后管理渠道将需要重启 ${toolName}\n`));
  }

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
    console.log(chalk.cyan(services.managedProviderConfig
      ? '\n[STOP]  正在切换 OMP 到单渠道直连模式...\n'
      : '\n[STOP]  正在停止代理服务...\n'));

    // 停止代理服务器
    await services.stopProxyServer();
    console.log(chalk.green(services.managedProviderConfig
      ? '[OK] OMP 已切换到单渠道直连模式'
      : '[OK] 代理服务已停止'));

    // 恢复配置文件
    if (!services.managedProviderConfig) {
      const settingsManager = getSettingsManager(cliType);
      settingsManager.deleteBackup?.();
      const restoredChannel = restoreSingleChannelMode(cliType);
      removeActiveChannelMarker(cliType);
      if (restoredChannel?.name) {
        console.log(chalk.green(`[OK] 已恢复到渠道: ${restoredChannel.name}`));
      } else {
        console.log(chalk.green('[OK] 已清理代理接管状态'));
      }
    } else {
      removeActiveChannelMarker(cliType);
      console.log(chalk.green('[OK] 已清理代理接管状态'));
    }

    console.log(chalk.cyan(services.managedProviderConfig ? '\n[TIP] OMP 动态切换已关闭' : '\n[TIP] 动态切换已关闭'));
    if (services.managedProviderConfig) {
      console.log(chalk.gray('   当前渠道保持直连；后续渠道和模型修改会立即同步到 OMP\n'));
    } else {
      console.log(chalk.gray(`   现在调整渠道需要重启 ${toolName} 才能生效\n`));
    }

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
  _test: {
    getProxyServices,
    getSettingsManager,
    pickRestoredChannel,
    restoreSingleChannelMode
  }
};
