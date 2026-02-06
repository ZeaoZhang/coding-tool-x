const chalk = require('chalk');
const { startServer } = require('../server');
const open = require('open');
const { getProxyStatus } = require('../server/proxy-server');
const { loadConfig } = require('../config/loader');

async function handleUI() {
  // 检查是否为 daemon 模式（PM2 启动）
  const isDaemon = process.argv.includes('--daemon');

  // 检查是否启用 LAN 访问 (--host 标志)
  const enableHost = process.argv.includes('--host');
  const host = enableHost ? '0.0.0.0' : '127.0.0.1';

  if (!isDaemon) {
    console.clear();
    console.log(chalk.cyan.bold('\n🌐 启动 Coding-Tool Web UI...\n'));
    if (enableHost) {
      console.log(chalk.yellow('⚠️  LAN 访问已启用 (--host)\n'));
    }
  }

  // 从配置加载端口
  const config = loadConfig();
  const port = config.ports?.webUI || 19999;
  const url = `http://localhost:${port}`;

  try {
    await startServer(port, host);

    // 自动打开浏览器（仅非 daemon 模式）
    if (!isDaemon) {
      setTimeout(async () => {
        try {
          await open(url);
          console.log(chalk.green(`✅ 已在浏览器中打开: ${url}\n`));
        } catch (err) {
          console.log(chalk.yellow(`💡 请手动打开: ${url}\n`));
        }
      }, 1000);
    }

    // 处理退出信号（仅非 daemon 模式）
    if (!isDaemon) {
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n\n👋 正在停止服务器...\n'));

      // 检查代理状态并询问是否停止
      try {
        const proxyStatus = getProxyStatus();
        if (proxyStatus.running) {
          console.log(chalk.yellow('⚠️  检测到代理服务正在运行'));
          console.log(chalk.gray('   - 代理端口: ' + proxyStatus.port));
          console.log(chalk.gray('   - 如需保持代理运行，请直接关闭此窗口\n'));

          // 自动停止代理（3秒后）
          console.log(chalk.cyan('⏳ 将在 3 秒后自动停止代理服务...'));
          console.log(chalk.gray('   按 Ctrl+C 再次可立即退出并保持代理运行\n'));

          let stopProxy = true;
          const secondSigint = () => {
            stopProxy = false;
            process.off('SIGINT', secondSigint);
          };
          process.on('SIGINT', secondSigint);

          await new Promise(resolve => setTimeout(resolve, 3000));
          process.off('SIGINT', secondSigint);

          if (stopProxy) {
            const { stopProxyServer } = require('../server/proxy-server');
            await stopProxyServer();
            console.log(chalk.green('✅ 代理服务已停止\n'));
          } else {
            console.log(chalk.yellow('⚠️  代理服务保持运行状态'));
            console.log(chalk.gray('   - 如需停止，请运行: ctx proxy stop\n'));
          }
        }
      } catch (err) {
        // 忽略错误
      }

      console.log(chalk.green('✅ Web UI 已停止\n'));
      process.exit(0);
    });

      console.log(chalk.gray('按 Ctrl+C 停止服务器'));
    } else {
      // Daemon 模式：保持运行
      console.log(chalk.green(`✅ Coding-Tool 服务已在后台启动 (端口: ${port})`));
    }

  } catch (error) {
    console.error(chalk.red('启动服务器失败:'), error.message);
    process.exit(1);
  }
}

module.exports = { handleUI };
