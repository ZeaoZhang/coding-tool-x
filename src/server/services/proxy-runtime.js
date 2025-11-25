const fs = require('fs');
const path = require('path');
const os = require('os');

function getRuntimeFilePath(proxyType) {
  const ccToolDir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, `${proxyType}-proxy-runtime.json`);
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

function getProxyStartTime(proxyType) {
  try {
    const filePath = getRuntimeFilePath(proxyType);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.startTime || null;
  } catch (err) {
    return null;
  }
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

function getProxyRuntime(proxyType) {
  const startTime = getProxyStartTime(proxyType);
  return startTime ? Date.now() - startTime : null;
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
