const chalk = require('chalk');
const http = require('http');
const { loadConfig } = require('../config/loader');
const { normalizePlatformKey } = require('../shared/platforms');

const CHANNEL_CONFIG = {
  claude: {
    name: 'Claude',
    icon: '[*]',
    aompPath: '/api/proxy'
  },
  codex: {
    name: 'Codex',
    icon: '[*]',
    aompPath: '/api/codex/proxy'
  },
  gemini: {
    name: 'Gemini',
    icon: '[*]',
    aompPath: '/api/gemini/proxy'
  },
  opencode: {
    name: 'OpenCode',
    icon: '[*]',
    aompPath: '/api/opencode/proxy'
  },
  omp: {
    name: 'OMP',
    icon: '[*]',
    aompPath: '/api/omp/proxy',
    serviceLabel: 'OMP 受管模型配置',
    proxyLabel: '受管模型配置',
    startAction: '启用',
    stopAction: '停用',
    restartAction: '重新同步',
    startedMessage: 'OMP 受管模型配置已启用',
    stoppedMessage: 'OMP 受管模型配置已停用',
    runningText: '已启用',
    stoppedText: '未启用',
    portLabel: '状态端口',
    addressLabel: '状态地址',
    startTip: '启用受管模型配置'
  }
};

function getServiceLabel(channelInfo) {
  return channelInfo.serviceLabel || `${channelInfo.name} 代理服务`;
}

function getProxyLabel(channelInfo) {
  return channelInfo.proxyLabel || '代理';
}

/**
 * HTTP 请求辅助函数
 */
function httpRequest(method, path, data = null) {
  const config = loadConfig();
  const port = config.ports?.webUI || 19999;

  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'localhost',
      port: port,
      path: path,
      method: method,
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

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

/**
 * 检查 UI 服务是否运行
 */
async function checkUIService() {
  try {
    await httpRequest('GET', '/api/proxy/status');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 启动代理
 */
async function handleProxyStart(channel) {
  const normalizedChannel = normalizePlatformKey(channel);
  const channelInfo = CHANNEL_CONFIG[normalizedChannel];
  if (!channelInfo) {
    console.error(chalk.red(`\n[ERROR] 无效的渠道类型: ${channel}\n`));
    console.log(chalk.gray('支持的渠道: claude, codex, gemini, opencode, omp\n'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n[START] ${channelInfo.startAction || '启动'} ${getServiceLabel(channelInfo)}...\n`));

  // 检查 UI 服务
  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('[ERROR] UI 服务未运行\n'));
    console.log(chalk.yellow('[TIP] 请先启动 UI 服务:'));
    console.log(chalk.gray('   ') + chalk.cyan('ctx start') + chalk.gray('  或  ') + chalk.cyan('ctx ui\n'));
    process.exit(1);
  }

  try {
    const response = await httpRequest('POST', `${channelInfo.aompPath}/start`);

    if (response.data.success) {
      console.log(chalk.green(`[OK] ${channelInfo.startedMessage || `${channelInfo.name} ${getProxyLabel(channelInfo)}已启动`}\n`));
      console.log(chalk.gray(`${channelInfo.icon} ${channelInfo.portLabel || '代理端口'}: ${response.data.port}`));
      console.log(chalk.gray(`[NET] ${channelInfo.addressLabel || '代理地址'}: http://localhost:${response.data.port}\n`));
    } else {
      console.error(chalk.red(`[ERROR] 启动失败: ${response.data.message}\n`));
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
async function handleProxyStop(channel) {
  const normalizedChannel = normalizePlatformKey(channel);
  const channelInfo = CHANNEL_CONFIG[normalizedChannel];
  if (!channelInfo) {
    console.error(chalk.red(`\n[ERROR] 无效的渠道类型: ${channel}\n`));
    console.log(chalk.gray('支持的渠道: claude, codex, gemini, opencode, omp\n'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n[STOP]  ${channelInfo.stopAction || '停止'} ${getServiceLabel(channelInfo)}...\n`));

  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('[ERROR] UI 服务未运行，无法停止代理\n'));
    process.exit(1);
  }

  try {
    const response = await httpRequest('POST', `${channelInfo.aompPath}/stop`);

    if (response.data.success) {
      console.log(chalk.green(`[OK] ${channelInfo.stoppedMessage || `${channelInfo.name} ${getProxyLabel(channelInfo)}已停止`}\n`));
    } else {
      console.error(chalk.red(`[ERROR] 停止失败: ${response.data.message}\n`));
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
async function handleProxyRestart(channel) {
  const normalizedChannel = normalizePlatformKey(channel);
  const channelInfo = CHANNEL_CONFIG[normalizedChannel];
  if (!channelInfo) {
    console.error(chalk.red(`\n[ERROR] 无效的渠道类型: ${channel}\n`));
    console.log(chalk.gray('支持的渠道: claude, codex, gemini, opencode, omp\n'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n[SYNC] ${channelInfo.restartAction || '重启'} ${getServiceLabel(channelInfo)}...\n`));

  await handleProxyStop(channel);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await handleProxyStart(channel);
}

/**
 * 查看代理状态
 */
async function handleProxyStatus(channel) {
  const normalizedChannel = normalizePlatformKey(channel);
  const channelInfo = CHANNEL_CONFIG[normalizedChannel];
  if (!channelInfo) {
    console.error(chalk.red(`\n[ERROR] 无效的渠道类型: ${channel}\n`));
    console.log(chalk.gray('支持的渠道: claude, codex, gemini, opencode, omp\n'));
    process.exit(1);
  }

  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.log(chalk.bold.cyan(`\n╔======================================╗`));
    console.log(chalk.bold.cyan(`║      ${getServiceLabel(channelInfo)}状态           ║`));
    console.log(chalk.bold.cyan(`╚======================================╝\n`));
    console.log(chalk.gray('  [ERROR] UI 服务未运行\n'));
    console.log(chalk.yellow('[TIP] 请先启动 UI 服务: ') + chalk.cyan('ctx start\n'));
    return;
  }

  try {
    const response = await httpRequest('GET', `${channelInfo.aompPath}/status`);
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
    console.log(chalk.gray(`  • 使用 `) + chalk.cyan(`ctx ${channel} start`) + chalk.gray(` ${channelInfo.startTip || '启动代理'}`));
    console.log(chalk.gray(`  • 使用 `) + chalk.cyan(`ctx logs ${channel}`) + chalk.gray(` 查看日志`));
    console.log(chalk.gray(`  • 使用 `) + chalk.cyan(`ctx stats ${channel}`) + chalk.gray(` 查看统计\n`));
  } catch (error) {
    console.error(chalk.red(`[ERROR] 查询状态失败: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * 格式化运行时长
 */
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
  } else {
    return `${seconds}秒`;
  }
}

module.exports = {
  handleProxyStart,
  handleProxyStop,
  handleProxyRestart,
  handleProxyStatus
};
