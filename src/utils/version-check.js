const https = require('https');
const fs = require('fs');
const path = require('path');

// 版本检查缓存，避免频繁重复请求
const versionCache = new Map();
const CACHE_TTL = 3600000; // 1小时缓存

/**
 * 从 npm registry 获取最新版本号
 * @param {string} packageName - npm 包名
 * @returns {Promise<string|null>} 最新版本号或 null（如果出错）
 */
function fetchLatestVersion(packageName) {
  return new Promise((resolve) => {
    // 检查缓存
    const cached = versionCache.get(packageName);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return resolve(cached.version);
    }

    const url = `https://registry.npmjs.org/${packageName}/latest`;
    let timedOut = false;

    const request = https.get(url, { timeout: 2000 }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (timedOut) return;

        try {
          const json = JSON.parse(data);
          const version = json.version || null;
          // 缓存结果
          if (version) {
            versionCache.set(packageName, { version, timestamp: Date.now() });
          }
          resolve(version);
        } catch (err) {
          resolve(null);
        }
      });
    });

    request.on('error', () => {
      if (!timedOut) {
        resolve(null);
      }
    });

    request.on('timeout', () => {
      timedOut = true;
      request.destroy();
      resolve(null);
    });
  });
}

/**
 * 获取当前版本号
 * @returns {string} 当前版本号
 */
function getCurrentVersion() {
  const packagePath = path.join(__dirname, '../../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return packageJson.version;
}

/**
 * 比较版本号
 * @param {string} v1 - 版本号1
 * @param {string} v2 - 版本号2
 * @returns {number} 1表示v1>v2, -1表示v1<v2, 0表示相等
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;

    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  return 0;
}

/**
 * 检查是否有新版本
 * @returns {Promise<{hasUpdate: boolean, current: string, latest: string|null}>}
 */
async function checkForUpdates() {
  const packageName = 'coding-tool';
  const currentVersion = getCurrentVersion();
  const latestVersion = await fetchLatestVersion(packageName);

  if (!latestVersion) {
    return {
      hasUpdate: false,
      current: currentVersion,
      latest: null,
      error: true
    };
  }

  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

  return {
    hasUpdate,
    current: currentVersion,
    latest: latestVersion
  };
}

module.exports = {
  checkForUpdates,
  getCurrentVersion,
  fetchLatestVersion,
  compareVersions
};
