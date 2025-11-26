const chalk = require('chalk');
const http = require('http');
const { loadConfig } = require('../config/loader');

const CHANNEL_CONFIG = {
  claude: {
    name: 'Claude',
    icon: '🟢',
    apiPath: '/api/proxy'
  },
  codex: {
    name: 'Codex',
    icon: '🔵',
    apiPath: '/api/codex-proxy'
  },
  gemini: {
    name: 'Gemini',
    icon: '🟣',
    apiPath: '/api/gemini-proxy'
  }
};

/**
 * HTTP 请求辅助函数
 */
function httpRequest(method, path, data = null) {
  const config = loadConfig();
  const port = config.ports?.webUI || 10099;

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
    await httpRequest('GET', '/api/ping');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 启动代理
 */
async function handleProxyStart(channel) {
  const channelInfo = CHANNEL_CONFIG[channel];
  if (!channelInfo) {
    console.error(chalk.red(`\n❌ 无效的渠道类型: ${channel}\n`));
    console.log(chalk.gray('支持的渠道: claude, codex, gemini\n'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n🚀 启动 ${channelInfo.name} 代理服务...\n`));

  // 检查 UI 服务
  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('❌ UI 服务未运行\n'));
    console.log(chalk.yellow('💡 请先启动 UI 服务:'));
    console.log(chalk.gray('   ') + chalk.cyan('ct start') + chalk.gray('  或  ') + chalk.cyan('ct ui\n'));
    process.exit(1);
  }

  try {
    const response = await httpRequest('POST', `${channelInfo.apiPath}/start`);

    if (response.data.success) {
      console.log(chalk.green(`✅ ${channelInfo.name} 代理已启动\n`));
      console.log(chalk.gray(`${channelInfo.icon} 代理端口: ${response.data.port}`));
      console.log(chalk.gray(`🌐 代理地址: http://localhost:${response.data.port}\n`));
    } else {
      console.error(chalk.red(`❌ 启动失败: ${response.data.message}\n`));
      process.exit(1);
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error(chalk.red('❌ 无法连接到 UI 服务\n'));
      console.log(chalk.yellow('💡 请确保 UI 服务正在运行: ') + chalk.cyan('ct start\n'));
    } else {
      console.error(chalk.red(`❌ 启动失败: ${error.message}\n`));
    }
    process.exit(1);
  }
}

/**
 * 停止代理
 */
async function handleProxyStop(channel) {
  const channelInfo = CHANNEL_CONFIG[channel];
  if (!channelInfo) {
    console.error(chalk.red(`\n❌ 无效的渠道类型: ${channel}\n`));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n⏹️  停止 ${channelInfo.name} 代理服务...\n`));

  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.error(chalk.red('❌ UI 服务未运行，无法停止代理\n'));
    process.exit(1);
  }

  try {
    const response = await httpRequest('POST', `${channelInfo.apiPath}/stop`);

    if (response.data.success) {
      console.log(chalk.green(`✅ ${channelInfo.name} 代理已停止\n`));
    } else {
      console.error(chalk.red(`❌ 停止失败: ${response.data.message}\n`));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`❌ 停止失败: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * 重启代理
 */
async function handleProxyRestart(channel) {
  const channelInfo = CHANNEL_CONFIG[channel];
  if (!channelInfo) {
    console.error(chalk.red(`\n❌ 无效的渠道类型: ${channel}\n`));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n🔄 重启 ${channelInfo.name} 代理服务...\n`));

  await handleProxyStop(channel);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await handleProxyStart(channel);
}

/**
 * 查看代理状态
 */
async function handleProxyStatus(channel) {
  const channelInfo = CHANNEL_CONFIG[channel];
  if (!channelInfo) {
    console.error(chalk.red(`\n❌ 无效的渠道类型: ${channel}\n`));
    process.exit(1);
  }

  const uiRunning = await checkUIService();
  if (!uiRunning) {
    console.log(chalk.bold.cyan(`\n╔══════════════════════════════════════╗`));
    console.log(chalk.bold.cyan(`║      ${channelInfo.name} 代理服务状态           ║`));
    console.log(chalk.bold.cyan(`╚══════════════════════════════════════╝\n`));
    console.log(chalk.gray('  ❌ UI 服务未运行\n'));
    console.log(chalk.yellow('💡 请先启动 UI 服务: ') + chalk.cyan('ct start\n'));
    return;
  }

  try {
    const response = await httpRequest('GET', `${channelInfo.apiPath}/status`);
    const status = response.data;

    console.log(chalk.bold.cyan(`\n╔══════════════════════════════════════╗`));
    console.log(chalk.bold.cyan(`║      ${channelInfo.name} 代理服务状态           ║`));
    console.log(chalk.bold.cyan(`╚══════════════════════════════════════╝\n`));

    if (status.running) {
      console.log(chalk.green('  ✅ 状态: 运行中'));
      console.log(chalk.gray(`  ${channelInfo.icon} 端口: ${status.port}`));
      console.log(chalk.gray(`  🌐 地址: http://localhost:${status.port}`));
      if (status.runtime) {
        console.log(chalk.gray(`  ⏱️  运行时长: ${formatRuntime(status.runtime)}`));
      }
    } else {
      console.log(chalk.gray('  ❌ 状态: 未运行'));
    }

    console.log(chalk.bold('\n💡 提示:'));
    console.log(chalk.gray(`  • 使用 `) + chalk.cyan(`ct ${channel} start`) + chalk.gray(` 启动代理`));
    console.log(chalk.gray(`  • 使用 `) + chalk.cyan(`ct logs ${channel}`) + chalk.gray(` 查看日志`));
    console.log(chalk.gray(`  • 使用 `) + chalk.cyan(`ct stats ${channel}`) + chalk.gray(` 查看统计\n`));
  } catch (error) {
    console.error(chalk.red(`❌ 查询状态失败: ${error.message}\n`));
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
