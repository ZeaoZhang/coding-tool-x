const express = require('express');
const router = express.Router();
const { loadConfig, saveConfig } = require('../../config/loader');
const DEFAULT_CONFIG = require('../../config/default');

function clampNumber(value, fallback) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num < 0) return 0;
  if (num > 1000) return 1000;
  return Math.round(num * 1000000) / 1000000;
}

function sanitizePricing(inputPricing, currentPricing) {
  const defaults = DEFAULT_CONFIG.pricing;
  const sanitized = {};

  Object.keys(defaults).forEach((toolKey) => {
    const defaultValue = defaults[toolKey];
    const existingValue = currentPricing?.[toolKey] || {};
    const payload = inputPricing?.[toolKey] || {};

    const mode = payload.mode === 'custom' ? 'custom' : (existingValue.mode || defaultValue.mode || 'auto');
    sanitized[toolKey] = { mode };

    Object.keys(defaultValue)
      .filter((key) => key !== 'mode')
      .forEach((rateKey) => {
        const fallback = existingValue[rateKey] !== undefined ? existingValue[rateKey] : defaultValue[rateKey];
        sanitized[toolKey][rateKey] = clampNumber(payload[rateKey], fallback);
      });
  });

  return sanitized;
}

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
      statsInterval: config.statsInterval || 30,
      enableSessionBinding: config.enableSessionBinding !== false, // 默认开启
      pricing: config.pricing || DEFAULT_CONFIG.pricing
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
    const { ports, maxLogs, statsInterval, pricing, enableSessionBinding } = req.body;

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
    const sanitizedPricing = sanitizePricing(pricing, config.pricing);

    let normalizedPorts = config.ports;
    if (ports) {
      normalizedPorts = { ...config.ports };
      Object.entries(ports).forEach(([key, value]) => {
        const port = parseInt(value);
        normalizedPorts[key] = port;
      });
    }

    // 更新配置
    const newConfig = {
      ...config,
      projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
      ports: normalizedPorts,
      maxLogs: maxLogs !== undefined ? parseInt(maxLogs) : config.maxLogs,
      statsInterval: statsInterval !== undefined ? parseInt(statsInterval) : config.statsInterval,
      enableSessionBinding: enableSessionBinding !== undefined ? enableSessionBinding : (config.enableSessionBinding !== false),
      pricing: sanitizedPricing
    };

    // 保存配置
    saveConfig(newConfig);

    res.json({
      success: true,
      config: {
        ports: newConfig.ports,
        maxLogs: newConfig.maxLogs,
        statsInterval: newConfig.statsInterval,
        enableSessionBinding: newConfig.enableSessionBinding,
        pricing: newConfig.pricing
      }
    });
  } catch (error) {
    console.error('[Config API] Failed to save advanced config:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
