const { execSync } = require('child_process');
const net = require('net');
const { isWindowsLikePlatform } = require('./home-dir');

let lastPortToolIssue = null;

function isWindowsLikeRuntime(platform = process.platform, env = process.env) {
  return isWindowsLikePlatform(platform, env);
}

function clearPortToolIssue() {
  lastPortToolIssue = null;
}

function rememberPortToolIssue(issue) {
  if (!lastPortToolIssue) {
    lastPortToolIssue = issue;
  }
  return lastPortToolIssue;
}

function getPortToolIssue() {
  return lastPortToolIssue;
}

function isMissingCommandError(error) {
  const message = [
    error && typeof error.message === 'string' ? error.message : '',
    error && typeof error.stderr === 'string'
      ? error.stderr
      : Buffer.isBuffer(error?.stderr)
        ? error.stderr.toString('utf-8')
        : ''
  ].join('\n');

  return error?.code === 'ENOENT' || /not found|not recognized as an internal or external command/i.test(message);
}

function createPortToolIssue(command, phase, isWindows) {
  if (isWindows) {
    return {
      command,
      phase,
      platform: 'windows',
      summary: `未找到系统命令 ${command}，无法${phase === 'kill' ? '关闭' : '检测'}占用端口的进程。`,
      hints: [
        '请确认已安装或启用 Windows 自带网络工具。',
        '请将 `C:\\Windows\\System32` 加入 PATH 后重试。'
      ]
    };
  }

  return {
    command,
    phase,
    platform: 'unix',
    summary: `未找到 ${command}，无法${phase === 'kill' ? '关闭' : '检测'}占用端口的进程。`,
    hints: [
      '请安装 `lsof`，或安装提供 `fuser` 的系统工具后重试。',
      '如果暂时不想安装，也可以改用其他端口。'
    ]
  };
}

function formatPortToolIssue(issue = lastPortToolIssue) {
  if (!issue) {
    return [];
  }

  return [issue.summary, ...issue.hints];
}

function parsePidsFromNetstatOutput(output, port) {
  const target = `:${port}`;
  const pids = new Set();

  String(output || '').split(/\r?\n/).forEach((line) => {
    const row = line.trim();
    if (!row || !row.includes(target)) {
      return;
    }
    if (row.startsWith('UDP') && !row.includes(`${target} `) && !row.endsWith(target)) {
      return;
    }
    const match = row.match(/\s+(\d+)\s*$/);
    if (match && match[1] !== '0') {
      pids.add(match[1]);
    }
  });

  return Array.from(pids);
}

/**
 * 检查端口是否被占用
 */
function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    let resolved = false;

    const finish = (value) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        finish(true);
      } else {
        finish(false);
      }
    });

    server.once('listening', () => {
      // 等待 close 完成后再返回，避免紧接着重新监听同端口时触发竞态
      server.close((err) => {
        if (err) {
          finish(true);
          return;
        }
        finish(false);
      });
    });

    server.listen(port, host);
  });
}

/**
 * 查找占用端口的进程PID（跨平台）
 */
function findProcessByPort(port) {
  clearPortToolIssue();
  const isWindows = isWindowsLikeRuntime();
  if (isWindows) {
    try {
      // Windows: 直接解析 netstat 输出，避免依赖 findstr/lsof
      const result = execSync('netstat -ano', { encoding: 'utf-8' });
      return parsePidsFromNetstatOutput(result, port);
    } catch (e) {
      if (isMissingCommandError(e)) {
        rememberPortToolIssue(createPortToolIssue('netstat', 'lookup', true));
      }
      return [];
    }
  }

  let lsofMissing = false;
  try {
    // macOS/Linux 使用 lsof
    const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
    return result.split('\n').filter(pid => pid);
  } catch (err) {
    lsofMissing = isMissingCommandError(err);
    // 如果 lsof 失败，尝试使用 fuser（某些 Linux 系统）
    try {
      const result = execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf-8' }).trim();
      return result.split(/\s+/).filter(pid => pid);
    } catch (e) {
      if (lsofMissing && isMissingCommandError(e)) {
        rememberPortToolIssue(createPortToolIssue('lsof / fuser', 'lookup', false));
      }
      return [];
    }
  }
}

/**
 * 杀掉占用端口的进程（跨平台）
 */
function killProcessByPort(port) {
  try {
    const pids = findProcessByPort(port);
    if (pids.length === 0) {
      return false;
    }

    const isWindows = isWindowsLikeRuntime();
    let killedAny = false;
    pids.forEach(pid => {
      try {
        if (isWindows) {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } else {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
        killedAny = true;
      } catch (err) {
        if (isWindows && isMissingCommandError(err)) {
          rememberPortToolIssue(createPortToolIssue('taskkill', 'kill', true));
        }
        // 忽略单个进程杀掉失败的错误
      }
    });

    return killedAny;
  } catch (err) {
    return false;
  }
}

/**
 * 等待端口释放
 */
async function waitForPortRelease(port, timeout = 3000, host = '127.0.0.1') {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const inUse = await isPortInUse(port, host);
    if (!inUse) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return false;
}

module.exports = {
  isPortInUse,
  findProcessByPort,
  killProcessByPort,
  waitForPortRelease,
  getPortToolIssue,
  formatPortToolIssue,
  isWindowsLikeRuntime,
  parsePidsFromNetstatOutput,
  _test: {
    isMissingCommandError,
    createPortToolIssue,
    formatPortToolIssue
  }
};
