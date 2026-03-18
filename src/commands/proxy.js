const { startProxyServer, stopProxyServer, getProxyStatus } = require('../server/proxy-server');
const {
  setProxyConfig,
  restoreSettings,
  isProxyConfig,
  settingsExists,
  hasBackup
} = require('../server/services/settings-manager');

/**
 * 启动代理
 */
async function handleProxyStart() {
  try {
    console.log('\n[START] 启动代理服务...\n');

    // 1. 检查配置文件
    if (!settingsExists()) {
      console.error('[ERROR] 未找到 Claude Code 配置文件');
      console.log('请至少运行一次 Claude Code 以生成配置文件');
      console.log('配置文件路径: ~/.claude/settings.json\n');
      process.exit(1);
    }

    // 2. 检查是否已经是代理配置
    if (isProxyConfig()) {
      console.log('[WARN]  已经配置为代理模式');
    }

    // 3. 启动代理服务器
    const proxyResult = await startProxyServer();

    if (!proxyResult.success) {
      console.error('[ERROR] 代理服务器启动失败\n');
      process.exit(1);
    }

    console.log(`[OK] 代理服务器已启动: http://127.0.0.1:${proxyResult.port}`);

    // 4. 修改配置文件
    const configResult = setProxyConfig(proxyResult.port);
    console.log('[OK] 配置文件已更新');

    if (hasBackup()) {
      console.log('[OK] 原配置已备份');
    }

    console.log('\n代理服务运行中...');
    console.log('现在可以使用 Claude Code，它将通过代理访问 API');
    console.log('使用 Ctrl+C 停止服务（配置不会恢复）');
    console.log('或使用 "ctx proxy stop" 停止并恢复配置\n');

    // 保持进程运行
    return new Promise(() => {
      // 处理退出信号
      process.on('SIGINT', async () => {
        console.log('\n\n[WARN]  收到退出信号');
        console.log('提示: 配置文件未恢复，使用 "ctx proxy stop" 恢复配置\n');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('[ERROR] 启动代理失败:', error.message);
    process.exit(1);
  }
}

/**
 * 停止代理
 */
async function handleProxyStop() {
  try {
    console.log('\n[STOP]  停止代理服务...\n');

    const status = getProxyStatus();

    // 1. 停止代理服务器
    if (status.running) {
      await stopProxyServer();
      console.log('[OK] 代理服务器已停止');
    } else {
      console.log('[WARN]  代理服务器未运行');
    }

    // 2. 恢复配置文件
    if (hasBackup()) {
      restoreSettings();
      console.log('[OK] 配置文件已恢复');
    } else {
      console.log('[WARN]  未找到备份文件，配置未恢复');
    }

    console.log('\n[OK] 代理已完全停止并清理\n');
  } catch (error) {
    console.error('[ERROR] 停止代理失败:', error.message);
    process.exit(1);
  }
}

/**
 * 显示代理状态
 */
function handleProxyStatus() {
  const chalk = require('chalk');
  console.log(chalk.bold.cyan('\n╔======================================╗'));
  console.log(chalk.bold.cyan('║          代理服务状态          ║'));
  console.log(chalk.bold.cyan('╚======================================╝\n'));

  const proxyStatus = getProxyStatus();
  const configIsProxy = isProxyConfig();
  const backup = hasBackup();

  console.log(chalk.bold('代理服务器:'));
  if (proxyStatus.running) {
    console.log(chalk.green(`  [OK] 状态: 运行中`));
    console.log(chalk.gray(`  [>] 端口: ${proxyStatus.port}`));
    console.log(chalk.gray(`  [NET] 地址: http://127.0.0.1:${proxyStatus.port}`));
  } else {
    console.log(chalk.gray(`  [ERROR] 状态: 未运行`));
  }

  console.log(chalk.bold('\n配置文件:'));
  console.log(`  代理模式: ${configIsProxy ? chalk.green('[OK] 已启用') : chalk.gray('[ERROR] 未启用')}`);
  console.log(`  配置备份: ${backup ? chalk.green('[OK] 存在') : chalk.gray('[ERROR] 不存在')}`);

  // 根据状态给出建议
  console.log(chalk.bold('\n[TIP] 建议操作:'));

  if (proxyStatus.running && configIsProxy) {
    console.log(chalk.green('  [v] 代理正常运行，Claude Code 将通过代理访问 API'));
    console.log(chalk.gray('  • 使用 Web UI (ctx ui) 可以动态管理渠道'));
    console.log(chalk.gray('  • 使用 ctx proxy stop 停止代理并恢复配置'));
  } else if (proxyStatus.running && !configIsProxy) {
    console.log(chalk.yellow('  [WARN]  代理服务在运行，但配置未启用代理模式'));
    console.log(chalk.gray('  • 配置可能被手动修改，建议运行: ctx proxy stop'));
  } else if (!proxyStatus.running && configIsProxy) {
    console.log(chalk.yellow('  [WARN]  配置为代理模式，但代理服务未运行'));
    console.log(chalk.gray('  • Claude Code 可能无法正常工作'));
    console.log(chalk.gray('  • 建议运行: ctx reset (恢复配置)'));
  } else {
    console.log(chalk.gray('  • 代理未运行，Claude Code 使用常规配置'));
    console.log(chalk.gray('  • 如需启用动态切换，运行: ctx ui'));
  }

  console.log('\n');
}

module.exports = {
  handleProxyStart,
  handleProxyStop,
  handleProxyStatus
};
