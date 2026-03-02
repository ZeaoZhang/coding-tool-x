const { execSync } = require('child_process');
const net = require('net');

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
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    try {
      // Windows: netstat -ano 列出所有连接，findstr 过滤端口
      const result = execSync(`netstat -ano | findstr ":${port} "`, { encoding: 'utf-8' });
      const pids = new Set();
      result.split('\n').forEach(line => {
        // 格式: "  TCP  0.0.0.0:9999  0.0.0.0:0  LISTENING  1234"
        const match = line.trim().match(/\s+(\d+)\s*$/);
        if (match) pids.add(match[1]);
      });
      return Array.from(pids).filter(pid => pid && pid !== '0');
    } catch (e) {
      return [];
    }
  }

  try {
    // macOS/Linux 使用 lsof
    const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
    return result.split('\n').filter(pid => pid);
  } catch (err) {
    // 如果 lsof 失败，尝试使用 fuser（某些 Linux 系统）
    try {
      const result = execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf-8' }).trim();
      return result.split(/\s+/).filter(pid => pid);
    } catch (e) {
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

    const isWindows = process.platform === 'win32';
    pids.forEach(pid => {
      try {
        if (isWindows) {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } else {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
      } catch (err) {
        // 忽略单个进程杀掉失败的错误
      }
    });

    return true;
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
  waitForPortRelease
};
