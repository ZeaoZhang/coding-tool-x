// 恢复会话命令
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const chalk = require('chalk');
const ora = require('ora');
const { getSessionsDir } = require('../utils/session');

/**
 * 恢复会话
 */
async function resumeSession(config, sessionId, fork = false) {
  // 构建命令参数
  const args = ['-r', sessionId];
  if (fork) {
    args.push('--fork-session');
  }

  // 从会话文件中提取原始工作目录
  const sessionFile = path.join(getSessionsDir(config), `${sessionId}.jsonl`);
  let cwd = process.cwd();

  try {
    const fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(2048);
    fs.readSync(fd, buffer, 0, 2048, 0);
    fs.closeSync(fd);

    const content = buffer.toString('utf8');
    const lines = content.split('\n').slice(0, 5);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.cwd) {
          cwd = json.cwd;
          break;
        }
      } catch (e) {
        // 继续
      }
    }
  } catch (e) {
    // 使用当前目录
  }

  // 显示加载动画
  const spinner = ora({
    text: chalk.cyan('正在准备启动 Claude...'),
    spinner: 'dots',
  }).start();

  // 等待 500ms，让用户看到加载状态
  await new Promise(resolve => setTimeout(resolve, 500));

  spinner.succeed(chalk.green('准备完成！\n'));

  console.log(chalk.gray('━'.repeat(50)));
  console.log(chalk.green.bold(`✨ 会话: ${sessionId.substring(0, 8)}`));
  console.log(chalk.gray(`📁 目录: ${cwd}`));
  console.log(chalk.gray('━'.repeat(50)) + '\n');

  // 完全清理终端状态，避免输入冲突
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch (e) {
      // 忽略
    }
  }

  // 移除所有 stdin 监听器，防止残留事件
  process.stdin.removeAllListeners();

  // 添加错误处理器，防止 EIO 错误导致崩溃
  process.stdin.on('error', (err) => {
    // 忽略 EIO 错误（通常发生在 Ctrl+C 时）
    if (err.code === 'EIO' || err.code === 'ENOTTY') {
      // 安静退出
      process.exit(0);
    }
  });

  // 暂停输入流
  process.stdin.pause();

  // 再等待 100ms 确保终端状态稳定
  await new Promise(resolve => setTimeout(resolve, 100));

  // 使用 execSync 完全替代当前进程
  // cc 会阻塞等待 claude 完成，然后一起退出
  // Claude 独占终端，不会有输入冲突
  try {
    const command = `claude ${args.join(' ')}`;

    // 切换到目标目录
    const originalCwd = process.cwd();
    try {
      process.chdir(cwd);
    } catch (e) {
      console.log(chalk.yellow(`\n⚠️  无法切换到目录: ${cwd}`));
      console.log(chalk.gray(`将在当前目录启动\n`));
    }

    // execSync 会阻塞并完全接管终端
    // 此时 cc 进程只是等待，不处理任何输入
    execSync(command, {
      stdio: 'inherit', // 完全继承 stdio，让 claude 控制终端
    });

    // 恢复目录
    try {
      process.chdir(originalCwd);
    } catch (e) {
      // 忽略
    }

    // Claude 正常退出 - 立即退出避免清理错误
    process.exit(0);
  } catch (error) {
    // Claude 执行出错或被用户中断（Ctrl+C）
    // 立即退出，不等待清理
    if (error.status !== undefined) {
      process.exit(error.status);
    } else if (error.signal === 'SIGINT') {
      // 用户按了 Ctrl+C，正常退出
      process.exit(0);
    } else {
      console.log(chalk.red(`\n❌ 启动失败: ${error.message}`));
      process.exit(1);
    }
  }
}

module.exports = {
  resumeSession,
};
