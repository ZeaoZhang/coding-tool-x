const fs = require('fs');
const pm2 = require('pm2');
const path = require('path');
const chalk = require('chalk');
const { loadConfig } = require('../config/loader');
const { PATHS, ensureStorageDirMigrated } = require('../config/paths');
const {
  findProcessByPort,
  killProcessByPort,
  waitForPortRelease,
  getPortToolIssue,
  formatPortToolIssue
} = require('../utils/port-helper');

const PM2_APP_NAME = 'cc-tool';
const STARTUP_LOG_FILE = 'cc-tool-out.log';
const CURRENT_PM2_FORK_PATH = resolveCurrentPm2ForkPath();

function resolveCurrentPm2ForkPath() {
  try {
    return require.resolve('pm2/lib/ProcessContainerFork');
  } catch {
    return '';
  }
}

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

function stopPM2Process(name) {
  return new Promise((resolve, reject) => {
    pm2.stop(name, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function deletePM2Process(name) {
  return new Promise((resolve, reject) => {
    pm2.delete(name, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function restartPM2Process(name) {
  return new Promise((resolve, reject) => {
    pm2.restart(name, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
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

function normalizePathForComparison(filePath) {
  return path.normalize(String(filePath || ''));
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function readLogChunkSince(filePath, startOffset = 0, maxBytes = 32768) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= startOffset) {
      return '';
    }

    const safeOffset = Math.max(0, startOffset);
    const readStart = Math.max(safeOffset, stat.size - maxBytes);
    const length = stat.size - readStart;
    if (length <= 0) {
      return '';
    }

    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, readStart);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function extractMissingPm2ForkScriptPath(logText = '') {
  const match = String(logText).match(/Cannot find module '([^']*ProcessContainerFork\.js)'/);
  return match ? match[1] : '';
}

function detectStalePm2RuntimeIssue(logText = '', currentForkPath = CURRENT_PM2_FORK_PATH) {
  const missingPath = extractMissingPm2ForkScriptPath(logText);
  if (!missingPath || !currentForkPath) {
    return null;
  }

  if (normalizePathForComparison(missingPath) === normalizePathForComparison(currentForkPath)) {
    return null;
  }

  return {
    missingPath,
    currentPath: currentForkPath
  };
}

function updatePM2Daemon() {
  return new Promise((resolve, reject) => {
    pm2.update((err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function dumpPM2State(options = {}) {
  const timeoutMs = options.timeoutMs || 2000;
  const force = options.force === true;

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ timedOut: true, err: null });
    }, timeoutMs);

    pm2.dump(force, (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut: false, err: err || null });
    });
  });
}

async function finalizePM2Session(options = {}) {
  const shouldPersist = options.persist === true;
  if (shouldPersist) {
    const result = await dumpPM2State({
      timeoutMs: options.timeoutMs,
      force: options.force === true
    });
    if (result.err) {
      console.log(chalk.yellow(`[WARN]  保存 PM2 状态失败: ${result.err.message}`));
    } else if (result.timedOut) {
      console.log(chalk.yellow('[WARN]  保存 PM2 状态超时，继续关闭 CLI 连接'));
    }
  }
  disconnectPM2();
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

function shouldStopPM2Process(status) {
  return !['stopped', 'errored', 'stopping', 'launching'].includes(String(status || '').toLowerCase());
}

function getManagedPorts(config = loadConfig()) {
  return [
    config.ports?.webUI || 19999,
    config.ports?.proxy || 20088,
    config.ports?.codexProxy || 20089,
    config.ports?.geminiProxy || 20090,
    config.ports?.opencodeProxy || 20091
  ].filter((port, index, list) => Number.isInteger(port) && port > 0 && list.indexOf(port) === index);
}

async function cleanupManagedPorts(config = loadConfig(), options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 3000;
  const ports = getManagedPorts(config);
  const released = [];
  const forced = [];
  const stillInUse = [];

  for (const port of ports) {
    if (await waitForPortRelease(port, timeoutMs)) {
      released.push(port);
      continue;
    }

    const killed = killProcessByPort(port);
    if (killed) {
      forced.push(port);
      if (await waitForPortRelease(port, timeoutMs)) {
        released.push(port);
        continue;
      }
    }

    stillInUse.push(port);
  }

  return {
    ports,
    released,
    forced,
    stillInUse,
    toolIssue: getPortToolIssue()
  };
}

async function stopAllManagedInstances(existingProcess, config = loadConfig()) {
  const warnings = [];
  const hadPM2Process = Boolean(existingProcess);
  const status = existingProcess?.pm2_env?.status || 'unknown';

  if (existingProcess) {
    if (shouldStopPM2Process(status)) {
      try {
        await stopPM2Process(PM2_APP_NAME);
      } catch (err) {
        warnings.push(`停止 PM2 进程失败: ${err.message}`);
      }
    }

    try {
      await deletePM2Process(PM2_APP_NAME);
    } catch (err) {
      warnings.push(`删除 PM2 进程记录失败: ${err.message}`);
    }
  }

  const cleanup = await cleanupManagedPorts(config, { timeoutMs: 3000 });

  return {
    hadPM2Process,
    pm2Status: status,
    cleanup,
    warnings
  };
}

function printStopResult(result) {
  const { hadPM2Process, cleanup, warnings } = result;
  const stoppedAny = hadPM2Process || cleanup.forced.length > 0;

  if (stoppedAny) {
    console.log(chalk.green('\n[OK] Coding-Tool 服务已停止\n'));
  } else {
    console.log(chalk.yellow('\n[WARN]  服务未在运行\n'));
  }

  if (cleanup.forced.length > 0) {
    console.log(chalk.yellow(`[WARN]  已额外清理残留端口: ${cleanup.forced.join(', ')}`));
  }
  if (cleanup.stillInUse.length > 0) {
    console.log(chalk.red(`[ERROR] 以下端口仍被占用: ${cleanup.stillInUse.join(', ')}`));
    printPortToolIssue(cleanup.toolIssue);
    console.log(chalk.yellow('[TIP] 请检查是否有外部进程仍占用这些端口\n'));
  }
  warnings.forEach((warning) => {
    console.log(chalk.yellow(`[WARN]  ${warning}`));
  });
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

function buildStartOptions(port, enableHost, enableHttps) {
  const pmArgs = ['ui', '--daemon'];
  if (enableHost) {
    pmArgs.push('--host');
  }
  if (enableHttps) {
    pmArgs.push('--https');
  }

  return {
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
    output: path.join(PATHS.logs, STARTUP_LOG_FILE),
    error: path.join(PATHS.logs, STARTUP_LOG_FILE),
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  };
}

async function attemptStartService(startOptions, port, options = {}) {
  const allowPm2Refresh = options.allowPm2Refresh !== false;
  const logPath = path.join(PATHS.logs, STARTUP_LOG_FILE);
  const logOffset = getFileSize(logPath);

  return new Promise((resolve, reject) => {
    pm2.start(startOptions, async (err) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        const readyState = await waitForServiceReady(port);
        if (readyState.ready) {
          resolve({ ok: true, readyState });
          return;
        }

        const recentLogText = readLogChunkSince(logPath, logOffset);
        const staleRuntimeIssue = allowPm2Refresh ? detectStalePm2RuntimeIssue(recentLogText) : null;

        if (staleRuntimeIssue) {
          console.log(chalk.yellow('\n[WARN]  检测到 PM2 守护进程仍引用旧的 pm2 运行时，正在自动刷新...'));
          console.log(chalk.gray(`旧路径: ${staleRuntimeIssue.missingPath}`));
          console.log(chalk.gray(`当前路径: ${staleRuntimeIssue.currentPath}`));

          await updatePM2Daemon();

          const recoveredState = await waitForServiceReady(port, 5000, 500);
          if (recoveredState.ready) {
            resolve({
              ok: true,
              readyState: recoveredState,
              recoveredFromStalePm2: staleRuntimeIssue
            });
            return;
          }

          try {
            await deletePM2Process(PM2_APP_NAME);
          } catch {
            // ignore stale process cleanup errors; the next retry will surface real failures
          }

          resolve({
            retry: true,
            recoveredFromStalePm2: staleRuntimeIssue
          });
          return;
        }

        resolve({
          ok: false,
          readyState
        });
      } catch (checkError) {
        reject(checkError);
      }
    });
  });
}

function cleanupFailedStart() {
  return new Promise((resolve) => {
    pm2.delete(PM2_APP_NAME, async () => {
      await finalizePM2Session({ persist: true });
      resolve();
    });
  });
}

/**
 * 启动服务（后台）
 */
async function handleStart() {
  try {
    const config = loadConfig();
    const port = config.ports?.webUI || 19999;
    const enableHost = process.argv.includes('--host');
    const enableHttps = process.argv.includes('--https');
    fs.mkdirSync(PATHS.logs, { recursive: true });

    let readyState = null;
    let recoveredFromStalePm2 = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await connectPM2();

      const existing = await getCCToolProcess();
      if (existing && existing.pm2_env.status === 'online') {
        if (recoveredFromStalePm2) {
          readyState = {
            ready: true,
            process: existing,
            degradedPortCheckIssue: getPortToolIssue()
          };
          break;
        }

        console.log(chalk.yellow('\n[WARN]  服务已在运行中\n'));
        console.log(chalk.gray(`进程 ID: ${existing.pid}`));
        console.log(chalk.gray(`运行时长: ${formatUptime(existing.pm2_env.pm_uptime)}`));
        console.log(chalk.gray('\n使用 ') + chalk.cyan('ctx status') + chalk.gray(' 查看详细状态'));
        console.log(chalk.gray('使用 ') + chalk.cyan('ctx restart') + chalk.gray(' 重启服务\n'));
        disconnectPM2();
        return;
      }

      const startResult = await attemptStartService(
        buildStartOptions(port, enableHost, enableHttps),
        port,
        { allowPm2Refresh: attempt === 0 }
      );

      if (startResult.retry) {
        recoveredFromStalePm2 = startResult.recoveredFromStalePm2 || recoveredFromStalePm2;
        disconnectPM2();
        continue;
      }

      if (!startResult.ok) {
        readyState = startResult.readyState;
        const statusText = readyState.process?.pm2_env?.status || 'unknown';
        console.error(chalk.red('\n[ERROR] Coding-Tool 服务启动失败，进程未就绪\n'));
        console.error(chalk.gray(`PM2 状态: ${statusText}`));
        printPortToolIssue(readyState.degradedPortCheckIssue);
        console.error(chalk.yellow('[TIP] 请使用 ctx logs ui 查看详细日志\n'));
        await cleanupFailedStart();
        disconnectPM2();
        process.exit(1);
      }

      readyState = startResult.readyState;
      recoveredFromStalePm2 = startResult.recoveredFromStalePm2 || recoveredFromStalePm2;
      break;
    }

    if (!readyState || !readyState.ready) {
      console.error(chalk.red('\n[ERROR] Coding-Tool 服务启动失败，PM2 守护进程刷新后仍未恢复\n'));
      disconnectPM2();
      process.exit(1);
    }

    console.log(chalk.green('\n[OK] Coding-Tool 服务已启动（后台运行）\n'));
    console.log(chalk.gray(`Web UI: ${enableHttps ? 'https' : 'http'}://localhost:${port}`));
    if (recoveredFromStalePm2) {
      console.log(chalk.green('[OK] 已自动修复旧 PM2 运行时路径残留'));
    }
    printPortToolIssue(readyState.degradedPortCheckIssue);
    if (enableHost) {
      console.log(chalk.yellow(`[WARN]  LAN 访问已启用 (${enableHttps ? 'https' : 'http'}://<your-ip>:${port})`));
    }
    console.log(chalk.gray('\n可以安全关闭此终端窗口'));
    console.log(chalk.gray('\n常用命令:'));
    console.log(chalk.gray('  ') + chalk.cyan('ctx status') + chalk.gray('   - 查看服务状态'));
    console.log(chalk.gray('  ') + chalk.cyan('ctx logs') + chalk.gray('      - 查看实时日志'));
    console.log(chalk.gray('  ') + chalk.cyan('ctx stop') + chalk.gray('      - 停止服务\n'));

    await finalizePM2Session({ persist: true });
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
    const config = loadConfig();

    const existing = await getCCToolProcess();
    const stopResult = await stopAllManagedInstances(existing, config);
    printStopResult(stopResult);

    await finalizePM2Session({
      persist: stopResult.hadPM2Process,
      force: true
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

    await restartPM2Process(PM2_APP_NAME);
    console.log(chalk.green('\n[OK] Coding-Tool 服务已重启\n'));
    await finalizePM2Session({ persist: true });
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
    detectStalePm2RuntimeIssue,
    extractMissingPm2ForkScriptPath,
    shouldTreatPortOwnershipAsReady,
    getManagedPorts,
    shouldStopPM2Process
  }
};
