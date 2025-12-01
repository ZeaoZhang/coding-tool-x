const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { checkForUpdates, getCurrentVersion } = require('../../utils/version-check');

/**
 * GET /api/version/check
 * 检查是否有新版本
 * 注意：版本检查可能需要 2+ 秒，建议前端异步调用
 */
router.get('/check', async (req, res) => {
  try {
    // 设置响应超时为 3 秒，如果 npm 请求超过 2 秒会自动失败
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          hasUpdate: false,
          current: getCurrentVersion(),
          latest: null,
          error: true,
          reason: 'version check timeout'
        });
      }, 2500);
    });

    const resultPromise = checkForUpdates();
    const result = await Promise.race([resultPromise, timeoutPromise]);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

/**
 * GET /api/version/current
 * 获取当前版本号
 */
router.get('/current', (req, res) => {
  try {
    const version = getCurrentVersion();
    res.json({
      version
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

/**
 * GET /api/version/changelog/:version
 * 获取指定版本的更新日志（从 GitHub CHANGELOG.md 或本地获取）
 */
router.get('/changelog/:version', async (req, res) => {
  const { version } = req.params;
  const owner = 'CooperJiang';
  const repo = 'coding-tool';
  const changelogUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/CHANGELOG.md`;

  try {
    // 使用 AbortController 实现超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(changelogUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'coding-tool'
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[Version] GitHub fetch failed: ${response.status} ${response.statusText}`);
      return res.status(502).json({
        error: true,
        message: `无法从 GitHub 获取更新日志 (HTTP ${response.status})`
      });
    }

    const content = await response.text();

    // 解析 Markdown，提取指定版本的内容
    const versionRegex = new RegExp(`## \\[${escapeRegExp(version)}\\][\\s\\S]*?(?=## \\[|$)`, 'i');
    const match = content.match(versionRegex);

    if (match) {
      return res.json({
        success: true,
        version,
        changelog: match[0],
        source: 'github'
      });
    }

    // GitHub 有内容但没找到该版本
    return res.status(404).json({
      error: true,
      message: `未找到版本 ${version} 的更新日志`
    });
  } catch (error) {
    console.error(`[Version] GitHub fetch error:`, error.message);

    if (error.name === 'AbortError') {
      return res.status(504).json({
        error: true,
        message: '获取更新日志超时，请稍后重试'
      });
    }

    return res.status(502).json({
      error: true,
      message: `无法连接到 GitHub: ${error.message}`
    });
  }
});

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /api/version/changelog
 * 获取完整的更新日志
 */
router.get('/changelog', (req, res) => {
  try {
    // 读取 changelog.json
    const changelogPath = path.join(__dirname, '../../..', 'changelog.json');

    if (!fs.existsSync(changelogPath)) {
      return res.status(404).json({
        error: true,
        message: '找不到 changelog.json'
      });
    }

    const changelogContent = fs.readFileSync(changelogPath, 'utf-8');
    const changelog = JSON.parse(changelogContent);

    res.json({
      success: true,
      changelog
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

module.exports = router;
