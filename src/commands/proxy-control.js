const chalk = require('chalk');
const http = require('http');
const { loadConfig } = require('../config/loader');
const { normalizePlatformKey } = require('../shared/platforms');

function getDefaultRegistry() {
  return require('../platforms/runtime').getPlatformRegistry();
}

function getSupportedPlatformKeys(registry = getDefaultRegistry()) {
  if (!registry || typeof registry.list !== 'function') return [];
  return registry.list().map(platform => platform && platform.key).filter(Boolean);
}

function getPlatformInfo(channel, registry = getDefaultRegistry()) {
  const key = normalizePlatformKey(channel);
  const definition = registry && typeof registry.resolve === 'function'
    ? registry.resolve(key)
    : null;
  if (!definition) return null;

  const labels = definition.proxyLabels && typeof definition.proxyLabels === 'object'
    ? definition.proxyLabels
    : {};
  const configuredPath = definition.apiBasePath || `/api/platforms/${key}`;
  const aompPath = configuredPath.replace(/\/+$/, '').endsWith('/proxy')
    ? configuredPath.replace(/\/+$/, '')
    : `${configuredPath.replace(/\/+$/, '')}/proxy`;
  return {
    ...labels,
    key,
    name: definition.label || definition.title || key,
    icon: labels.icon || '[*]',
    aompPath,
    defaultPort: definition.defaultPort,
    portKey: definition.portKey,
    managedProviderConfig: definition.proxyMode === 'managed'
  };
}

function createHttpRequest(loadConfigImpl = loadConfig) {
  return function request(method, requestPath, data = null) {
    const config = loadConfigImpl();
    const port = config.ports?.webUI || 19999;

    return new Promise((resolve, reject) => {
      const postData = data ? JSON.stringify(data) : null;
      const options = {
        hostname: 'localhost',
        port,
        path: requestPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(postData && { 'Content-Length': Buffer.byteLength(postData) })
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(responseData);
            resolve({ data: json, status: res.statusCode });
          } catch (err) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (postData) req.write(postData);
      req.end();
    });
  };
}

function createProxyControl({ registry = getDefaultRegistry(), httpRequest: request, loadConfig: loadConfigImpl, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const requestImpl = request || createHttpRequest(loadConfigImpl || loadConfig);

  function resolve(channel) {
    const info = getPlatformInfo(channel, registry);
    if (!info) {
      const error = new Error(`Invalid platform: ${channel}`);
      error.code = 'INVALID_PLATFORM';
      throw error;
    }
    return info;
  }

  return {
    resolve,
    async checkUIService() {
      try {
        await requestImpl('GET', '/api/proxy/status');
        return true;
      } catch (err) {
        return false;
      }
    },
    async start(channel) {
      const info = resolve(channel);
      const response = await requestImpl('POST', `${info.aompPath}/start`);
      return { info, response };
    },
    async stop(channel) {
      const info = resolve(channel);
      const response = await requestImpl('POST', `${info.aompPath}/stop`);
      return { info, response };
    },
    async status(channel) {
      const info = resolve(channel);
      const response = await requestImpl('GET', `${info.aompPath}/status`);
      return { info, response };
    },
    async restart(channel) {
      const info = resolve(channel);
      await requestImpl('POST', `${info.aompPath}/stop`);
      await sleep(1000);
      const response = await requestImpl('POST', `${info.aompPath}/start`);
      return { info, response };
    }
  };
}

function printInvalidPlatform(channel, registry) {
  const supported = getSupportedPlatformKeys(registry);
  console.error(chalk.red(`\n[ERROR] 无效的渠道类型: ${channel}\n`));
  if (supported.length > 0) {
    console.log(chalk.gray(`支持的渠道: ${supported.join(', ')}\n`));
  }
}

/**
 * 启动代理
 */
async function handleProxyStart(channel, dependencies = {}) {
  const control = createProxyControl(dependencies);
  let channelInfo;
  try {
    channelInfo = control.resolve(channel);
  } catch (error) {
    printInvalidPlatform(channel, dependencies.registry);
    process.exit(1);
    return;
  }

  console.log(chalk.cyan(`\n[START] ${channelInfo.startAction || '启动'} ${getServiceLabel(channelInfo)}...\n`));

  const uiRunning = await control.checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('[ERROR] UI 服务未运行\n'));
    console.log(chalk.yellow('[TIP] 请先启动 UI 服务:'));
    console.log(chalk.gray('   ') + chalk.cyan('ctx start') + chalk.gray('  或  ') + chalk.cyan('ctx ui\n'));
    process.exit(1);
    return;
  }

  try {
    const { response } = await control.start(channel);
    const payload = response.data || {};

    if (payload.success) {
      console.log(chalk.green(`[OK] ${channelInfo.startedMessage || `${channelInfo.name} ${getProxyLabel(channelInfo)}已启动`}\n`));
      console.log(chalk.gray(`${channelInfo.icon} ${channelInfo.portLabel || '代理端口'}: ${payload.port}`));
      console.log(chalk.gray(`[NET] ${channelInfo.addressLabel || '代理地址'}: http://localhost:${payload.port}\n`));
    } else {
      console.error(chalk.red(`[ERROR] 启动失败: ${payload.message || payload.error || 'Unknown error'}\n`));
      process.exit(1);
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error(chalk.red('[ERROR] 无法连接到 UI 服务\n'));
      console.log(chalk.yellow('[TIP] 请确保 UI 服务正在运行: ') + chalk.cyan('ctx start\n'));
    } else {
      console.error(chalk.red(`[ERROR] 启动失败: ${error.message}\n`));
    }
    process.exit(1);
  }
}

/**
 * 停止代理
 */
async function handleProxyStop(channel, dependencies = {}) {
  const control = createProxyControl(dependencies);
  let channelInfo;
  try {
    channelInfo = control.resolve(channel);
  } catch (error) {
    printInvalidPlatform(channel, dependencies.registry);
    process.exit(1);
    return;
  }

  console.log(chalk.cyan(`\n[STOP]  ${channelInfo.stopAction || '停止'} ${getServiceLabel(channelInfo)}...\n`));

  const uiRunning = await control.checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('[ERROR] UI 服务未运行，无法停止代理\n'));
    process.exit(1);
    return;
  }

  try {
    const { response } = await control.stop(channel);
    const payload = response.data || {};

    if (payload.success) {
      console.log(chalk.green(`[OK] ${channelInfo.stoppedMessage || `${channelInfo.name} ${getProxyLabel(channelInfo)}已停止`}\n`));
    } else {
      console.error(chalk.red(`[ERROR] 停止失败: ${payload.message || payload.error || 'Unknown error'}\n`));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`[ERROR] 停止失败: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * 重启代理
 */
async function handleProxyRestart(channel, dependencies = {}) {
  const control = createProxyControl(dependencies);
  let channelInfo;
  try {
    channelInfo = control.resolve(channel);
  } catch (error) {
    printInvalidPlatform(channel, dependencies.registry);
    process.exit(1);
    return;
  }

  console.log(chalk.cyan(`\n[SYNC] ${channelInfo.restartAction || '重启'} ${getServiceLabel(channelInfo)}...\n`));
  const uiRunning = await control.checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('[ERROR] UI 服务未运行，无法重启代理\n'));
    process.exit(1);
    return;
  }

  try {
    const { response } = await control.restart(channel);
    const payload = response.data || {};
    if (!payload.success) {
      console.error(chalk.red(`[ERROR] 重启失败: ${payload.message || payload.error || 'Unknown error'}\n`));
      process.exit(1);
      return;
    }
    console.log(chalk.green(`[OK] ${channelInfo.startedMessage || `${channelInfo.name} ${getProxyLabel(channelInfo)}已重启`}\n`));
  } catch (error) {
    console.error(chalk.red(`[ERROR] 重启失败: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * 查看代理状态
 */
async function handleProxyStatus(channel, dependencies = {}) {
  const control = createProxyControl(dependencies);
  let channelInfo;
  try {
    channelInfo = control.resolve(channel);
  } catch (error) {
    printInvalidPlatform(channel, dependencies.registry);
    process.exit(1);
    return;
  }

  const uiRunning = await control.checkUIService();
  if (!uiRunning) {
    console.log(chalk.bold.cyan(`\n╔======================================╗`));
    console.log(chalk.bold.cyan(`║      ${getServiceLabel(channelInfo)}状态           ║`));
    console.log(chalk.bold.cyan(`╚======================================╝\n`));
    console.log(chalk.gray('  [ERROR] UI 服务未运行\n'));
    console.log(chalk.yellow('[TIP] 请先启动 UI 服务: ') + chalk.cyan('ctx start\n'));
    return;
  }

  try {
    const { response } = await control.status(channel);
    const payload = response.data || {};
    const status = payload.proxy || payload;

    console.log(chalk.bold.cyan(`\n╔======================================╗`));
    console.log(chalk.bold.cyan(`║      ${getServiceLabel(channelInfo)}状态           ║`));
    console.log(chalk.bold.cyan(`╚======================================╝\n`));

    if (status.running) {
      console.log(chalk.green(`  [OK] 状态: ${channelInfo.runningText || '运行中'}`));
      console.log(chalk.gray(`  ${channelInfo.icon} ${channelInfo.portLabel || '端口'}: ${status.port}`));
      console.log(chalk.gray(`  [NET] ${channelInfo.addressLabel || '地址'}: http://localhost:${status.port}`));
      if (status.runtime) {
        console.log(chalk.gray(`  [TIMER]  运行时长: ${formatRuntime(status.runtime)}`));
      }
    } else {
      console.log(chalk.gray(`  [ERROR] 状态: ${channelInfo.stoppedText || '未运行'}`));
    }

    console.log(chalk.bold('\n[TIP] 提示:'));
    console.log(chalk.gray('  • 使用 ') + chalk.cyan(`ctx ${channel} start`) + chalk.gray(` ${channelInfo.startTip || '启动代理'}`));
    console.log(chalk.gray('  • 使用 ') + chalk.cyan(`ctx logs ${channel}`) + chalk.gray(' 查看日志'));
    console.log(chalk.gray('  • 使用 ') + chalk.cyan(`ctx stats ${channel}`) + chalk.gray(' 查看统计\n'));
  } catch (error) {
    console.error(chalk.red(`[ERROR] 查询状态失败: ${error.message}\n`));
    process.exit(1);
  }
}

function getServiceLabel(channelInfo) {
  return channelInfo.serviceLabel || `${channelInfo.name} 代理服务`;
}

function getProxyLabel(channelInfo) {
  return channelInfo.proxyLabel || '代理';
}

function formatRuntime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}天 ${hours % 24}小时`;
  } else if (hours > 0) {
    return `${hours}小时 ${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${seconds}秒`;
}

module.exports = {
  handleProxyStart,
  handleProxyStop,
  handleProxyRestart,
  handleProxyStatus,
  createProxyControl,
  _test: {
    createHttpRequest,
    getPlatformInfo,
    getSupportedPlatformKeys,
    formatRuntime
  }
};
