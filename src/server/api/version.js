const express = require('express');
const router = express.Router();
const { checkForUpdates, getCurrentVersion } = require('../../utils/version-check');

/**
 * GET /api/version/check
 * 检查是否有新版本
 */
router.get('/check', async (req, res) => {
  try {
    const result = await checkForUpdates();
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

module.exports = router;
