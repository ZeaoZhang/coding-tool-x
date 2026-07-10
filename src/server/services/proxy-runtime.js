const fs = require('fs');
const path = require('path');
const { PATHS } = require('../../config/paths');
 
const LOG_RECOVERY_BYTES = 1024 * 1024;
const LOG_FILE_PATH = path.join(PATHS.logs, 'cc-tool-out.log');
const PROXY_START_LOG_PATTERNS = {
  claude: [
    /Proxy server started on http:\/\/127\.0\.0\.1:\d+/,
    /Claude 代理已自动启动，端口: \d+/
  ],
  codex: [/Codex proxy server started on http:\/\/127\.0\.0\.1:\d+/],
  gemini: [/Gemini proxy server started on http:\/\/127\.0\.0\.1:\d+/],
  opencode: [/OpenCode proxy server started on http:\/\/127\.0\.0\.1:\d+/],
  omp: [
    /OMP models\.yml provider config enabled, port: \d+/,
    /OMP models\.yml 受管 provider 已自动启用，端口: \d+/
  ]
};

function getRuntimeFilePath(proxyType) {
  const filePath = PATHS.proxyRuntime?.[proxyType]
    || path.join(path.dirname(PATHS.proxyRuntime.claude), `${proxyType}-proxy.json`);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return filePath;
}

function saveProxyStartTime(proxyType, preserveExisting = false) {
  try {
    const filePath = getRuntimeFilePath(proxyType);
    if (preserveExisting && fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    const data = { startTime: Date.now(), type: proxyType };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return data;
  } catch (err) {
    console.error(`Failed to save ${proxyType} proxy start time:`, err);
    return null;
  }
}

function toValidStartTime(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function persistRecoveredStartTime(proxyType, startTime, recoveredFrom) {
  const validStartTime = toValidStartTime(startTime);
  if (!validStartTime) {
    return null;
  }

  const runtimeFilePath = getRuntimeFilePath(proxyType);
  const data = {
    startTime: validStartTime,
    type: proxyType,
    recoveredFrom
  };
  fs.writeFileSync(runtimeFilePath, JSON.stringify(data, null, 2), 'utf8');
  return validStartTime;
}

function readStoredProxyStartTime(proxyType) {
  try {
    const filePath = getRuntimeFilePath(proxyType);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return toValidStartTime(data.startTime);
  } catch (err) {
    return null;
  }
}

function parseTimestampPrefix(line) {
  const match = String(line || '').match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):/);
  if (!match) {
    return null;
  }

  const parsed = Date.parse(match[1].replace(' ', 'T'));
  return toValidStartTime(parsed);
}

function recoverProxyStartTimeFromLogs(proxyType) {
  try {
    if (!fs.existsSync(LOG_FILE_PATH)) {
      return null;
    }

    const patterns = PROXY_START_LOG_PATTERNS[proxyType];
    if (!Array.isArray(patterns) || patterns.length === 0) {
      return null;
    }

    const stat = fs.statSync(LOG_FILE_PATH);
    const start = Math.max(0, stat.size - LOG_RECOVERY_BYTES);
    const fd = fs.openSync(LOG_FILE_PATH, 'r');

    try {
      const length = stat.size - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);

      const lines = buffer.toString('utf8').split(/\r?\n/).reverse();
      for (const line of lines) {
        if (!patterns.some(pattern => pattern.test(line))) {
          continue;
        }

        const timestamp = parseTimestampPrefix(line);
        if (timestamp) {
          return persistRecoveredStartTime(proxyType, timestamp, 'log');
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    console.warn(`Failed to recover ${proxyType} proxy start time from logs:`, err.message);
  }

  return null;
}

function recoverProxyStartTime(proxyType) {
  try {
    const logRecoveredStartTime = recoverProxyStartTimeFromLogs(proxyType);
    if (logRecoveredStartTime) {
      return logRecoveredStartTime;
    }

    const activeChannelPath = PATHS.activeChannel?.[proxyType];
    if (!activeChannelPath || !fs.existsSync(activeChannelPath)) {
      return null;
    }

    const recoveredStartTime = toValidStartTime(fs.statSync(activeChannelPath).mtimeMs);
    if (!recoveredStartTime) {
      return null;
    }

    return persistRecoveredStartTime(proxyType, recoveredStartTime, 'active-channel');
  } catch (err) {
    console.warn(`Failed to recover ${proxyType} proxy start time from active channel:`, err.message);
    return null;
  }
}

function getProxyStartTime(proxyType, options = {}) {
  const storedStartTime = readStoredProxyStartTime(proxyType);
  if (storedStartTime) {
    return storedStartTime;
  }

  if (options.allowRecovery) {
    return recoverProxyStartTime(proxyType);
  }

  return null;
}

function clearProxyStartTime(proxyType) {
  try {
    const filePath = getRuntimeFilePath(proxyType);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Failed to clear ${proxyType} proxy start time:`, err);
  }
}

function getProxyRuntime(proxyType, options = {}) {
  const startTime = getProxyStartTime(proxyType, options);
  return startTime ? Math.max(0, Date.now() - startTime) : null;
}

function formatRuntime(ms) {
  if (!ms || ms < 0) {
    return { hours: 0, minutes: 0, seconds: 0, formatted: '0秒' };
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let formatted = '';
  if (hours > 0) formatted += `${hours}小时`;
  if (minutes > 0) formatted += `${minutes}分`;
  if (seconds > 0 || formatted === '') formatted += `${seconds}秒`;

  return { hours, minutes, seconds, formatted };
}

module.exports = {
  saveProxyStartTime,
  getProxyStartTime,
  clearProxyStartTime,
  getProxyRuntime,
  formatRuntime
};
