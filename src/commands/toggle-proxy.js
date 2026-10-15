// 动态切换开关命令
const fs = require('fs');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { loadConfig } = require('../config/loader');
const { getPlatformStatePath } = require('../config/paths');
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
    clearNativeOAuth: typeof driver.clearNativeOAuth === 'function'
      ? (...args) => unwrapDriverResult(driver.clearNativeOAuth(...args))
      : undefined,
    preserveNativeOAuthOnProxyStart: driver.preserveNativeOAuthOnProxyStart === true,
    restoreNativeSettingsOnProxyStop: driver.restoreNativeSettingsOnProxyStop === true,
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
  };
}

function removeActiveChannelMarker(cliType) {
  const normalizedCliType = normalizePlatformKey(cliType || 'claude');
  const markerPath = getPlatformStatePath('activeChannel', normalizedCliType);
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
  const markerPath = getPlatformStatePath('activeChannel', normalizedCliType);
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
  const labels = services.proxyLabels || {};
  const serviceLabel = labels.serviceLabel || `${toolName} 代理服务`;
  const proxyLabel = labels.proxyLabel || '动态切换';
  const addressLabel = labels.addressLabel || (services.managedProviderConfig ? '网关地址' : '代理地址');

  console.log(chalk.cyan('动态切换功能说明:'));
  if (services.managedProviderConfig) {
    console.log(chalk.gray(`• 开启后会启动${serviceLabel}，并将平台原生 provider 指向本地网关`));
    console.log(chalk.gray(`• 可以通过 Web UI 或"渠道管理"功能调整启用的 ${toolName} 渠道`));
    console.log(chalk.gray('• 网关按平台路由设置分发请求，模型 fallback 仍由平台处理'));
    console.log(chalk.gray(`• ${addressLabel}: http://127.0.0.1:${defaultPort}\n`));
  } else {
    console.log(chalk.gray('• 开启后会在本地启动一个代理服务'));
    console.log(chalk.gray(`• 可以在不重启 ${toolName} 的情况下动态管理渠道`));
    console.log(chalk.gray('• 通过 Web UI 或"渠道管理"功能快速调整启用的线路'));
    console.log(chalk.gray(`• 代理服务地址: http://127.0.0.1:${defaultPort}\n`));
  }

  console.log(chalk.yellow('[WARN]  重要提示:'));
  if (services.managedProviderConfig) {
    console.log(chalk.yellow('• 启用后会写入指向本地网关的受管 provider 配置'));
    console.log(chalk.yellow('• 关闭时会由平台 Driver 按原生配置策略完成交接\n'));
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
      ? `\n[START] 正在启用${serviceLabel}...\n`
      : '\n[START] 正在启动代理服务...\n'));

    // 启动代理服务器
    const proxyResult = await services.startProxyServer();

    if (!proxyResult.success) {
      throw new Error(services.managedProviderConfig ? `${serviceLabel}启用失败` : '代理服务器启动失败');
    }

    if (services.managedProviderConfig) {
      console.log(chalk.green(`[OK] ${labels.startedMessage || `${serviceLabel}已启用`}`));
      (proxyResult.warnings || []).forEach((warning) => {
        console.log(chalk.yellow(`[WARN]  ${warning}`));
      });
    } else {
      const settingsManager = getSettingsManager(cliType);
      if (!settingsManager) {
        throw new Error(`平台 ${cliType} 未提供 nativeConfig 能力`);
      }
      if (!settingsManager.preserveNativeOAuthOnProxyStart) {
        settingsManager.clearNativeOAuth?.(cliType);
      }
      settingsManager.setProxyConfig(proxyResult.port);
      console.log(chalk.green('[OK] 配置文件已更新'));

      if (settingsManager.hasBackup()) {
        console.log(chalk.green('[OK] 原配置已备份'));
      }
    }

    console.log(chalk.cyan(`\n[TIP] ${labels.startedMessage || `${proxyLabel}已启用`}！`));
    if (services.managedProviderConfig) {
      console.log(chalk.gray(`   现在可以通过"渠道管理"功能调整已启用的 ${toolName} 渠道\n`));
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
  const labels = services.proxyLabels || {};
  const serviceLabel = labels.serviceLabel || `${toolName} 代理服务`;
  const proxyLabel = labels.proxyLabel || '动态切换';

  console.log(chalk.cyan('当前状态:'));
  if (services.managedProviderConfig) {
    console.log(chalk.gray(`• ${proxyLabel}: ${chalk.green(labels.runningText || '已启用')}`));
    console.log(chalk.gray(`• 配置模式: ${proxyStatus.mode || '平台受管 provider 配置'}`));
  } else {
    console.log(chalk.gray(`• 代理服务: ${chalk.green('运行中')}`));
    console.log(chalk.gray(`• 代理端口: ${proxyStatus.port}`));
    console.log(chalk.gray(`• 代理地址: http://127.0.0.1:${proxyStatus.port}\n`));
  }

  console.log(chalk.yellow('关闭后:'));
  if (services.managedProviderConfig) {
    console.log(chalk.gray(`• ${serviceLabel}会按平台 Driver 策略交接原生 provider 配置`));
    console.log(chalk.gray(`• 之后调整 ${toolName} 渠道或模型将按平台配置策略生效\n`));
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
      ? `\n[STOP]  正在停止${serviceLabel}...\n`
      : '\n[STOP]  正在停止代理服务...\n'));

    // 停止代理服务器
    await services.stopProxyServer();
    console.log(chalk.green(services.managedProviderConfig
      ? (labels.stoppedMessage || `${serviceLabel}已停止`)
      : '[OK] 代理服务已停止'));

    // 恢复配置文件
    if (!services.managedProviderConfig) {
      const settingsManager = getSettingsManager(cliType);
      const hasBackup = settingsManager?.hasBackup?.() === true;
      if (hasBackup && settingsManager.restoreNativeSettingsOnProxyStop && settingsManager.restoreSettings) {
        settingsManager.restoreSettings();
      } else if (hasBackup) {
        settingsManager.deleteBackup?.();
      }
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

    console.log(chalk.cyan(`\n[TIP] ${labels.stoppedMessage || `${proxyLabel}已关闭`}`));
    if (services.managedProviderConfig) {
      console.log(chalk.gray(`   ${toolName} 渠道配置已交由平台 Driver 处理\n`));
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
