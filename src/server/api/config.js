const express = require('express');
const router = express.Router();
const { loadConfig, saveConfig } = require('../../config/loader');

/**
 * GET /api/config/advanced
 * 获取高级配置（端口、日志、性能等）
 */
router.get('/advanced', (req, res) => {
  try {
    const config = loadConfig();
    res.json({
      ports: {
        webUI: config.ports?.webUI || 10099,
        proxy: config.ports?.proxy || 10088,
        codexProxy: config.ports?.codexProxy || 10089,
        geminiProxy: config.ports?.geminiProxy || 10090
      },
      maxLogs: config.maxLogs || 100,
      statsInterval: config.statsInterval || 30
    });
  } catch (error) {
    console.error('[Config API] Failed to get advanced config:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/config/advanced
 * 保存高级配置
 */
router.post('/advanced', (req, res) => {
  try {
    const { ports, maxLogs, statsInterval } = req.body;

    // 验证端口
    if (ports) {
      for (const [key, value] of Object.entries(ports)) {
        const port = parseInt(value);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return res.status(400).json({
            error: `Invalid port for ${key}: must be between 1024-65535`
          });
        }
      }
    }

    // 验证日志数量
    if (maxLogs !== undefined) {
      const logs = parseInt(maxLogs);
      if (isNaN(logs) || logs < 50 || logs > 500) {
        return res.status(400).json({
          error: 'maxLogs must be between 50-500'
        });
      }
    }

    // 验证刷新间隔
    if (statsInterval !== undefined) {
      const interval = parseInt(statsInterval);
      if (isNaN(interval) || interval < 10 || interval > 300) {
        return res.status(400).json({
          error: 'statsInterval must be between 10-300'
        });
      }
    }

    // 加载当前配置
    const config = loadConfig();

    // 更新配置
    const newConfig = {
      projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
      defaultProject: config.defaultProject,
      maxDisplaySessions: config.maxDisplaySessions,
      pageSize: config.pageSize,
      ports: ports || config.ports,
      maxLogs: maxLogs !== undefined ? parseInt(maxLogs) : config.maxLogs,
      statsInterval: statsInterval !== undefined ? parseInt(statsInterval) : config.statsInterval
    };

    // 保存配置
    saveConfig(newConfig);

    res.json({
      success: true,
      config: {
        ports: newConfig.ports,
        maxLogs: newConfig.maxLogs,
        statsInterval: newConfig.statsInterval
      }
    });
  } catch (error) {
    console.error('[Config API] Failed to save advanced config:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
