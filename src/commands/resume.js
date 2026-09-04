// 恢复会话命令
const chalk = require('chalk');
const ora = require('ora');
const { resolveOperation } = require('../platforms/access');

function isDriverResult(value) {
  return value && typeof value === 'object' && typeof value.status === 'string';
}

function unwrapDriverResult(value) {
  if (!isDriverResult(value) || value.status !== 'ok') return value;
  return value.data;
}

function createFailureResult(error, platform) {
  const result = {
    status: error?.code || 'failed',
    platform: error?.platform || platform || 'claude',
    capability: 'sessions',
    operation: 'launch',
    error: error?.message || String(error)
  };
  if (error?.cause) {
    Object.defineProperty(result, 'cause', { value: error.cause, enumerable: false });
  }
  return result;
}

function reportFailure(result) {
  const message = result.error || `会话启动 ${result.operation || 'launch'} 不可用`;
  const output = result.status === 'unsupported' || result.status === 'not_found'
    ? chalk.yellow
    : chalk.red;
  console.log(output(`\n[${result.status === 'unsupported' ? 'WARN' : 'ERROR'}] ${message}\n`));
}
/**
 * 恢复会话
 */
async function resumeSession(config = {}, sessionId, fork = false, options = {}) {
  const platform = options.platform || config.currentCliType || '';
  let resolved;
  try {
    resolved = resolveOperation(platform, 'sessions', 'launch', {
      ...options,
      fallback: 'claude'
    });
  } catch (error) {
    const result = createFailureResult(error, platform);
    reportFailure(result);
    return result;
  }

  const manifest = resolved.manifest || {};
  const displayName = manifest.label || manifest.title || resolved.key;
  let cwd = options.cwd || process.cwd();
  const spinner = ora({
    text: chalk.cyan(`正在准备启动 ${displayName}...`),
    spinner: 'dots'
  }).start();

  await new Promise(resolve => setTimeout(resolve, 500));

  spinner.succeed(chalk.green('准备完成！\n'));

  console.log(chalk.gray('━'.repeat(50)));
  console.log(chalk.green.bold(`[NEW] 会话: ${String(sessionId).substring(0, 8)}`));
  console.log(chalk.gray(`[DIR] 目录: ${cwd}`));
  console.log(chalk.gray('━'.repeat(50)) + '\n');

  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch (error) {
      // 忽略终端状态错误
    }
  }

  process.stdin.removeAllListeners();
  process.stdin.on('error', error => {
    if (error.code === 'EIO' || error.code === 'ENOTTY') {
      process.exit(0);
    }
  });
  process.stdin.pause();

  await new Promise(resolve => setTimeout(resolve, 100));

  const launchOptions = {
    fork,
    config
  };
  if (options.cwd !== undefined) launchOptions.cwd = options.cwd;
  if (options.processRunner) launchOptions.processRunner = options.processRunner;

  let launchResult;
  try {
    launchResult = unwrapDriverResult(await resolved.operation(sessionId, launchOptions));
  } catch (error) {
    launchResult = createFailureResult(error, resolved.key);
  }

  if (isDriverResult(launchResult) && launchResult.status !== 'ok') {
    reportFailure(launchResult);
    if (launchResult.status === 'unsupported' || launchResult.status === 'not_found') {
      return launchResult;
    }
    process.exit(1);
    return launchResult;
  }

  cwd = launchResult?.cwd || cwd;
  if (launchResult?.signal === 'SIGINT') {
    process.exit(0);
    return launchResult;
  }
  if (launchResult?.error) {
    console.log(chalk.red(`\n[ERROR] 启动失败: ${launchResult.error.message || launchResult.error}`));
    process.exit(1);
    return launchResult;
  }
  if (launchResult?.status !== undefined && launchResult.status !== null) {
    const exitStatus = Number(launchResult.status);
    if (Number.isFinite(exitStatus) && exitStatus !== 0) {
      process.exit(exitStatus);
      return launchResult;
    }
  }
  process.exit(0);
  return launchResult;
}

module.exports = {
  resumeSession,
};
