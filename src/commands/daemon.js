const pm2 = require('pm2');
const path = require('path');
const chalk = require('chalk');
const { loadConfig } = require('../config/loader');
const { PATHS, ensureStorageDirMigrated } = require('../config/paths');
const { findProcessByPort, getPortToolIssue, formatPortToolIssue } = require('../utils/port-helper');

const PM2_APP_NAME = 'cc-tool';

/**
 * 连接到 PM2
 */
function connectPM2() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * 断开 PM2 连接
 */
function disconnectPM2() {
  pm2.disconnect();
}

/**
 * 获取进程列表
 */
function getProcessList() {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) {
        reject(err);
      } else {
        resolve(list);
      }
    });
  });
}

/**
 * 获取 Coding-Tool 进程
 */
async function getCCToolProcess() {
  const list = await getProcessList();
  return list.find(proc => proc.name === PM2_APP_NAME);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPortOwnedByPid(port, pid) {
  if (!pid || pid <= 0) {
    return false;
  }
  const pids = findProcessByPort(port);
  if (getPortToolIssue()) {
    return null;
  }
  return pids.includes(String(pid));
}

function printPortToolIssue(issue = getPortToolIssue()) {
  const lines = formatPortToolIssue(issue);
  if (lines.length === 0) {
    return;
  }

  console.log(chalk.yellow(`\n[WARN]  ${lines[0]}`));
  lines.slice(1).forEach((line) => {
    console.log(chalk.gray(`   ${line}`));
  });
}

function shouldTreatPortOwnershipAsReady(ownsPort) {
  return ownsPort === true || ownsPort === null;
}

async function waitForServiceReady(port, timeoutMs = 15000, intervalMs = 500) {
  const startAt = Date.now();
  let lastProcess = null;
  let stablePassCount = 0;
  let degradedPortCheckIssue = null;

  while (Date.now() - startAt < timeoutMs) {
    lastProcess = await getCCToolProcess();
    if (lastProcess && lastProcess.pm2_env.status === 'online') {
      const ownsPort = isPortOwnedByPid(port, lastProcess.pid);
      if (shouldTreatPortOwnershipAsReady(ownsPort)) {
        // 连续多次检查通过，避免“瞬时 online 但马上崩溃”的误报
        stablePassCount += 1;
        if (ownsPort === null) {
          degradedPortCheckIssue = getPortToolIssue();
        }
      } else {
        degradedPortCheckIssue = getPortToolIssue();
        stablePassCount = 0;
      }

      if (stablePassCount >= 3) {
        return {
          ready: true,
          process: lastProcess,
          degradedPortCheckIssue
        };
      }
    } else {
      stablePassCount = 0;
    }
    await sleep(intervalMs);
  }

  lastProcess = await getCCToolProcess();
  return {
    ready: false,
    process: lastProcess,
    degradedPortCheckIssue: degradedPortCheckIssue || getPortToolIssue()
  };
}

/**
 * 启动服务（后台）
 */
async function handleStart() {
  try {
    await connectPM2();

    // 检查是否已经在运行
    const existing = await getCCToolProcess();
    if (existing && existing.pm2_env.status === 'online') {
      console.log(chalk.yellow('\n[WARN]  服务已在运行中\n'));
      console.log(chalk.gray(`进程 ID: ${existing.pid}`));
      console.log(chalk.gray(`运行时长: ${formatUptime(existing.pm2_env.pm_uptime)}`));
      console.log(chalk.gray('\n使用 ') + chalk.cyan('ctx status') + chalk.gray(' 查看详细状态'));
      console.log(chalk.gray('使用 ') + chalk.cyan('ctx restart') + chalk.gray(' 重启服务\n'));
      disconnectPM2();
      return;
    }

    const config = loadConfig();
    const port = config.ports?.webUI || 19999;

    // 检查是否启用 LAN 访问 (--host 标志)
    const enableHost = process.argv.includes('--host');
    const pmArgs = ['ui', '--daemon'];
    if (enableHost) {
      pmArgs.push('--host');
    }
    require('fs').mkdirSync(PATHS.logs, { recursive: true });

    // 启动 PM2 进程
    pm2.start({
      name: PM2_APP_NAME,
      script: path.join(__dirname, '../index.js'),
      args: pmArgs,
      interpreter: 'node',
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        CC_TOOL_PORT: port
      },
      output: path.join(PATHS.logs, 'cc-tool-out.log'),
      error: path.join(PATHS.logs, 'cc-tool-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }, async (err) => {
      if (err) {
        console.error(chalk.red('\n[ERROR] 启动服务失败:'), err.message);
        disconnectPM2();
        process.exit(1);
      }

      let readyState = null;
      try {
        readyState = await waitForServiceReady(port);
        if (!readyState.ready) {
          const statusText = readyState.process?.pm2_env?.status || 'unknown';
          console.error(chalk.red('\n[ERROR] Coding-Tool 服务启动失败，进程未就绪\n'));
          console.error(chalk.gray(`PM2 状态: ${statusText}`));
          printPortToolIssue(readyState.degradedPortCheckIssue);
          console.error(chalk.yellow('[TIP] 请使用 ctx logs ui 查看详细日志\n'));

          pm2.delete(PM2_APP_NAME, () => {
            pm2.dump(() => {
              disconnectPM2();
              process.exit(1);
            });
          });
          return;
        }
      } catch (checkError) {
        console.error(chalk.red('\n[ERROR] 启动后健康检查失败:'), checkError.message);
        disconnectPM2();
        process.exit(1);
      }

      console.log(chalk.green('\n[OK] Coding-Tool 服务已启动（后台运行）\n'));
      console.log(chalk.gray(`Web UI: http://localhost:${port}`));
      printPortToolIssue(readyState.degradedPortCheckIssue);
      if (enableHost) {
        console.log(chalk.yellow(`[WARN]  LAN 访问已启用 (http://<your-ip>:${port})`));
      }
      console.log(chalk.gray('\n可以安全关闭此终端窗口'));
      console.log(chalk.gray('\n常用命令:'));
      console.log(chalk.gray('  ') + chalk.cyan('ctx status') + chalk.gray('   - 查看服务状态'));
      console.log(chalk.gray('  ') + chalk.cyan('ctx logs') + chalk.gray('      - 查看实时日志'));
      console.log(chalk.gray('  ') + chalk.cyan('ctx stop') + chalk.gray('      - 停止服务\n'));

      // 保存进程列表
      pm2.dump((err) => {
        disconnectPM2();
      });
    });
  } catch (error) {
    console.error(chalk.red('启动失败:'), error.message);
    disconnectPM2();
    process.exit(1);
  }
}

/**
 * 停止服务
 */
async function handleStop() {
  try {
    await connectPM2();

    const existing = await getCCToolProcess();
    if (!existing) {
      console.log(chalk.yellow('\n[WARN]  服务未在运行\n'));
      disconnectPM2();
      return;
    }

    pm2.stop(PM2_APP_NAME, (err) => {
      if (err) {
        console.error(chalk.red('\n[ERROR] 停止服务失败:'), err.message);
        disconnectPM2();
        process.exit(1);
      }

      // 删除进程
      pm2.delete(PM2_APP_NAME, (err) => {
        if (err) {
          console.error(chalk.red('删除进程失败:'), err.message);
        } else {
          console.log(chalk.green('\n[OK] Coding-Tool 服务已停止\n'));
        }

        pm2.dump((err) => {
          disconnectPM2();
        });
      });
    });
  } catch (error) {
    console.error(chalk.red('停止失败:'), error.message);
    disconnectPM2();
    process.exit(1);
  }
}

/**
 * 重启服务
 */
async function handleRestart() {
  try {
    await connectPM2();

    const existing = await getCCToolProcess();
    if (!existing) {
      console.log(chalk.yellow('\n[WARN]  服务未在运行，请使用 ') + chalk.cyan('ctx start') + chalk.yellow(' 启动\n'));
      disconnectPM2();
      return;
    }

    pm2.restart(PM2_APP_NAME, (err) => {
      if (err) {
        console.error(chalk.red('\n[ERROR] 重启服务失败:'), err.message);
        disconnectPM2();
        process.exit(1);
      }

      console.log(chalk.green('\n[OK] Coding-Tool 服务已重启\n'));

      pm2.dump((err) => {
        disconnectPM2();
      });
    });
  } catch (error) {
    console.error(chalk.red('重启失败:'), error.message);
    disconnectPM2();
    process.exit(1);
  }
}

/**
 * 查看服务状态
 */
async function handleStatus() {
  try {
    await connectPM2();

    const existing = await getCCToolProcess();
    const config = loadConfig();

    console.log(chalk.bold.cyan('\n╔======================================╗'));
    console.log(chalk.bold.cyan('║        Coding-Tool 服务状态         ║'));
    console.log(chalk.bold.cyan('╚======================================╝\n'));

    // UI 服务状态
    console.log(chalk.bold('[UI] Web UI 服务:'));
    if (existing && existing.pm2_env.status === 'online') {
      console.log(chalk.green('  [OK] 状态: 运行中'));
      console.log(chalk.gray(`  [NET] 地址: http://localhost:${config.ports?.webUI || 19999}`));
      console.log(chalk.gray(`  [KEY] 进程 ID: ${existing.pid}`));
      console.log(chalk.gray(`  [TIMER]  运行时长: ${formatUptime(existing.pm2_env.pm_uptime)}`));
      console.log(chalk.gray(`  [SAVE] 内存使用: ${formatMemory(existing.monit?.memory)}`));
      console.log(chalk.gray(`  [SYNC] 重启次数: ${existing.pm2_env.restart_time}`));
    } else {
      console.log(chalk.gray('  [ERROR] 状态: 未运行'));
    }

    // 代理服务状态（从运行时文件检测）
    const fs = require('fs');
    ensureStorageDirMigrated();
    const claudeActive = fs.existsSync(PATHS.activeChannel.claude);
    const codexActive = fs.existsSync(PATHS.activeChannel.codex);
    const geminiActive = fs.existsSync(PATHS.activeChannel.gemini);
    const opencodeActive = fs.existsSync(PATHS.activeChannel.opencode);

    console.log(chalk.bold('\n[PROXY] 代理服务:'));

    console.log(chalk.gray('  Claude:  ') + (claudeActive ? chalk.green('[OK] 运行中') : chalk.gray('[STOP]  未启动')) +
      chalk.gray(` (http://localhost:${config.ports?.proxy || 20088})`));

    console.log(chalk.gray('  Codex:   ') + (codexActive ? chalk.green('[OK] 运行中') : chalk.gray('[STOP]  未启动')) +
      chalk.gray(` (http://localhost:${config.ports?.codexProxy || 20089})`));

    console.log(chalk.gray('  Gemini:  ') + (geminiActive ? chalk.green('[OK] 运行中') : chalk.gray('[STOP]  未启动')) +
      chalk.gray(` (http://localhost:${config.ports?.geminiProxy || 20090})`));

    console.log(chalk.gray('  OpenCode:') + (opencodeActive ? chalk.green('[OK] 运行中') : chalk.gray('[STOP]  未启动')) +
      chalk.gray(` (http://localhost:${config.ports?.opencodeProxy || 20091})`));

    console.log(chalk.bold('\n[TIP] 提示:'));
    console.log(chalk.gray('  • 代理服务通过 Web UI 界面控制'));
    console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx logs [type]') + chalk.gray(' 查看日志'));
    console.log(chalk.gray('  • 使用 ') + chalk.cyan('ctx stats [type]') + chalk.gray(' 查看统计信息\n'));

    disconnectPM2();
  } catch (error) {
    console.error(chalk.red('查询状态失败:'), error.message);
    disconnectPM2();
    process.exit(1);
  }
}

/**
 * 格式化运行时长
 */
function formatUptime(startTime) {
  const uptime = Date.now() - startTime;
  const seconds = Math.floor(uptime / 1000);
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

/**
 * 格式化内存使用
 */
function formatMemory(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}

module.exports = {
  handleStart,
  handleStop,
  handleRestart,
  handleStatus,
  _test: {
    shouldTreatPortOwnershipAsReady
  }
};
