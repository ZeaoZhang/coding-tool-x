const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 代理运行时间管理服务
 */

// 获取运行时间文件路径
function getRuntimeFilePath(proxyType) {
  const ccToolDir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, `${proxyType}-proxy-runtime.json`);
}

/**
 * 保存代理启动时间
 * @param {string} proxyType - 代理类型：'claude', 'codex', 'gemini'
 */
function saveProxyStartTime(proxyType) {
  try {
    const filePath = getRuntimeFilePath(proxyType);
    const data = {
      startTime: Date.now(),
      type: proxyType
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[${proxyType} Proxy] Runtime saved: started at ${new Date(data.startTime).toLocaleString()}`);
    return data;
  } catch (err) {
    console.error(`Failed to save ${proxyType} proxy start time:`, err);
    return null;
  }
}

/**
 * 获取代理启动时间
 * @param {string} proxyType - 代理类型：'claude', 'codex', 'gemini'
 * @returns {number|null} 启动时间戳，如果没有则返回null
 */
function getProxyStartTime(proxyType) {
  try {
    const filePath = getRuntimeFilePath(proxyType);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.startTime || null;
  } catch (err) {
    console.error(`Failed to load ${proxyType} proxy start time:`, err);
    return null;
  }
}

/**
 * 清除代理启动时间
 * @param {string} proxyType - 代理类型：'claude', 'codex', 'gemini'
 */
function clearProxyStartTime(proxyType) {
  try {
    const filePath = getRuntimeFilePath(proxyType);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[${proxyType} Proxy] Runtime cleared`);
    }
  } catch (err) {
    console.error(`Failed to clear ${proxyType} proxy start time:`, err);
  }
}

/**
 * 获取代理运行时长（毫秒）
 * @param {string} proxyType - 代理类型：'claude', 'codex', 'gemini'
 * @returns {number|null} 运行时长（毫秒），如果未运行则返回null
 */
function getProxyRuntime(proxyType) {
  const startTime = getProxyStartTime(proxyType);
  if (!startTime) {
    return null;
  }
  return Date.now() - startTime;
}

/**
 * 格式化运行时长
 * @param {number} ms - 毫秒数
 * @returns {object} 格式化后的时间对象 {hours, minutes, seconds, formatted}
 */
function formatRuntime(ms) {
  if (!ms || ms < 0) {
    return { hours: 0, minutes: 0, seconds: 0, formatted: '0秒' };
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let formatted = '';
  if (hours > 0) {
    formatted += `${hours}小时`;
  }
  if (minutes > 0) {
    formatted += `${minutes}分`;
  }
  if (seconds > 0 || formatted === '') {
    formatted += `${seconds}秒`;
  }

  return { hours, minutes, seconds, formatted };
}

module.exports = {
  saveProxyStartTime,
  getProxyStartTime,
  clearProxyStartTime,
  getProxyRuntime,
  formatRuntime
};
