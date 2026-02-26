const express = require('express');
const router = express.Router();
const { loadConfig, saveConfig } = require('../../config/loader');
const DEFAULT_CONFIG = require('../../config/default');
const { getAllChannels } = require('../services/channels');
const { getChannels: getCodexChannels } = require('../services/codex-channels');
const { getChannels: getGeminiChannels } = require('../services/gemini-channels');
const {
  probeModelAvailability,
  fetchModelsFromProvider,
  getModelPriority
} = require('../services/model-detector');

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

function uniqueModels(models = []) {
  const seen = new Set();
  const result = [];

  models.forEach((model) => {
    if (typeof model !== 'string') return;
    const trimmed = model.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  });

  return result;
}

function collectChannelPreferredModels(channel) {
  const candidates = [];
  if (!channel || typeof channel !== 'object') return candidates;

  candidates.push(channel.model);
  candidates.push(channel.speedTestModel);

  const modelConfig = channel.modelConfig;
  if (modelConfig && typeof modelConfig === 'object') {
    candidates.push(modelConfig.model);
    candidates.push(modelConfig.opusModel);
    candidates.push(modelConfig.sonnetModel);
    candidates.push(modelConfig.haikuModel);
  }

  if (Array.isArray(channel.modelRedirects)) {
    channel.modelRedirects.forEach((rule) => {
      candidates.push(rule?.from);
      candidates.push(rule?.to);
    });
  }

  return uniqueModels(candidates);
}

function parseBooleanQuery(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

async function probeModelsForSingleChannel(channel, channelType, options = {}) {
  const builtInPreferred = Array.isArray(DEFAULT_CONFIG.defaultModels?.[channelType])
    ? DEFAULT_CONFIG.defaultModels[channelType]
    : [];
  const preferredModels = uniqueModels([
    ...collectChannelPreferredModels(channel),
    ...builtInPreferred
  ]);

  try {
    if (channelType === 'codex') {
      const listResult = await fetchModelsFromProvider(channel, 'openai_compatible');
      const listedModels = Array.isArray(listResult?.models) ? listResult.models : [];
      if (listedModels.length > 0) {
        return uniqueModels(listedModels);
      }
    }

    const probe = await probeModelAvailability(channel, channelType, {
      forceRefresh: !!options.forceRefresh,
      stopOnFirstAvailable: true,
      preferredModels
    });
    const probedModels = Array.isArray(probe?.availableModels) ? probe.availableModels : [];
    if (probedModels.length > 0) {
      return uniqueModels(probedModels);
    }
  } catch (error) {
    console.warn(`[Config API] Probe failed for channel ${channel?.name || channel?.id || 'unknown'}: ${error.message}`);
  }

  return preferredModels;
}

async function probeModelsForChannels(channels = [], channelType, options = {}) {
  const enabledChannels = (channels || []).filter(ch => ch && ch.enabled !== false);
  if (enabledChannels.length === 0) return [];

  const resultSets = await Promise.all(
    enabledChannels.map(channel => probeModelsForSingleChannel(channel, channelType, options))
  );
  return uniqueModels(resultSets.flat());
}

function mergeProbedAndConfiguredModels(probedModels, configuredModels, toolType) {
  const safeConfigured = Array.isArray(configuredModels) ? configuredModels : [];
  const safeProbed = Array.isArray(probedModels) ? probedModels : [];
  const builtInDefaults = Array.isArray(DEFAULT_CONFIG.defaultModels?.[toolType])
    ? DEFAULT_CONFIG.defaultModels[toolType]
    : [];
  if (safeProbed.length > 0) {
    return uniqueModels([...safeProbed, ...safeConfigured, ...builtInDefaults]);
  }
  return uniqueModels([...safeConfigured, ...getModelPriority(toolType), ...builtInDefaults]);
}

/**
 * Validate model list
 * @param {Array} models - Array of model names
 * @param {string} toolType - Tool type (claude, codex, gemini)
 * @returns {Object} { valid: boolean, cleaned: array, error?: string }
 */
function validateModelList(models, toolType) {
  if (!Array.isArray(models)) {
    return { valid: false, error: `${toolType}: models must be an array` };
  }

  if (models.length === 0) {
    return { valid: false, error: `${toolType}: model list cannot be empty` };
  }

  if (models.length > 50) {
    return { valid: false, error: `${toolType}: maximum 50 models allowed, got ${models.length}` };
  }

  const modelNamePattern = /^[a-zA-Z0-9._\-/:]+$/;
  const cleaned = [];
  const seen = new Set();

  for (let i = 0; i < models.length; i++) {
    const model = models[i];

    if (typeof model !== 'string') {
      return { valid: false, error: `${toolType}: model at index ${i} must be a string, got ${typeof model}` };
    }

    const trimmed = model.trim();

    if (trimmed.length === 0) {
      return { valid: false, error: `${toolType}: model at index ${i} is empty or whitespace` };
    }

    if (!modelNamePattern.test(trimmed)) {
      return { valid: false, error: `${toolType}: model "${trimmed}" contains invalid characters (allowed: a-z A-Z 0-9 . _ - / :)` };
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      cleaned.push(trimmed);
    }
  }

  return { valid: true, cleaned };
}

/**
 * GET /api/config/default-models
 * 获取默认模型列表
 */
router.get('/default-models', async (req, res) => {
  try {
    const config = loadConfig();
    const configuredDefaultModels = config.defaultModels || DEFAULT_CONFIG.defaultModels;
    const probe = parseBooleanQuery(req.query.probe, false);

    if (!probe) {
      return res.json({
        defaultModels: configuredDefaultModels,
        probed: false
      });
    }

    const forceRefresh = parseBooleanQuery(req.query.forceRefresh, true);
    const [claudeChannels, codexData, geminiData] = await Promise.all([
      Promise.resolve(getAllChannels()),
      Promise.resolve(getCodexChannels()),
      Promise.resolve(getGeminiChannels())
    ]);

    const [claudeProbed, codexProbed, geminiProbed] = await Promise.all([
      probeModelsForChannels(claudeChannels || [], 'claude', { forceRefresh }),
      probeModelsForChannels(codexData?.channels || [], 'codex', { forceRefresh }),
      probeModelsForChannels(geminiData?.channels || [], 'gemini', { forceRefresh })
    ]);

    const defaultModels = {
      claude: mergeProbedAndConfiguredModels(
        claudeProbed,
        configuredDefaultModels.claude,
        'claude'
      ),
      codex: mergeProbedAndConfiguredModels(
        codexProbed,
        configuredDefaultModels.codex,
        'codex'
      ),
      gemini: mergeProbedAndConfiguredModels(
        geminiProbed,
        configuredDefaultModels.gemini,
        'gemini'
      )
    };

    res.json({
      defaultModels,
      probed: true,
      forceRefresh
    });
  } catch (error) {
    console.error('[Config API] Failed to get default models:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/config/default-models
 * 更新默认模型列表
 */
router.post('/default-models', (req, res) => {
  try {
    const { defaultModels } = req.body;

    if (!defaultModels || typeof defaultModels !== 'object') {
      return res.status(400).json({
        error: 'defaultModels must be an object'
      });
    }

    const validToolTypes = ['claude', 'codex', 'gemini'];
    const providedTypes = Object.keys(defaultModels);

    // Validate that only valid tool types are provided
    for (const toolType of providedTypes) {
      if (!validToolTypes.includes(toolType)) {
        return res.status(400).json({
          error: `Invalid tool type: ${toolType}. Valid types: ${validToolTypes.join(', ')}`
        });
      }
    }

    // Validate each model list
    const validated = {};
    const errors = {};

    for (const toolType of providedTypes) {
      const result = validateModelList(defaultModels[toolType], toolType);
      if (!result.valid) {
        errors[toolType] = result.error;
      } else {
        validated[toolType] = result.cleaned;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }

    // Load current config and merge
    const config = loadConfig();
    const newDefaultModels = {
      ...(config.defaultModels || DEFAULT_CONFIG.defaultModels),
      ...validated
    };

    // Save config
    const newConfig = {
      ...config,
      projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
      defaultModels: newDefaultModels
    };

    saveConfig(newConfig);

    res.json({
      success: true,
      defaultModels: newDefaultModels
    });
  } catch (error) {
    console.error('[Config API] Failed to save default models:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/config/default-models/reset
 * 重置默认模型列表
 */
router.post('/default-models/reset', (req, res) => {
  try {
    const { toolType } = req.body;

    const config = loadConfig();
    let newDefaultModels;

    if (toolType) {
      // Reset specific tool type
      const validToolTypes = ['claude', 'codex', 'gemini'];
      if (!validToolTypes.includes(toolType)) {
        return res.status(400).json({
          error: `Invalid tool type: ${toolType}. Valid types: ${validToolTypes.join(', ')}`
        });
      }

      newDefaultModels = {
        ...(config.defaultModels || DEFAULT_CONFIG.defaultModels),
        [toolType]: DEFAULT_CONFIG.defaultModels[toolType]
      };
    } else {
      // Reset all tool types
      newDefaultModels = { ...DEFAULT_CONFIG.defaultModels };
    }

    // Save config
    const newConfig = {
      ...config,
      projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
      defaultModels: newDefaultModels
    };

    saveConfig(newConfig);

    res.json({
      success: true,
      defaultModels: newDefaultModels
    });
  } catch (error) {
    console.error('[Config API] Failed to reset default models:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/config/advanced
 * 获取高级配置（端口、日志、性能等）
 */
router.get('/advanced', (req, res) => {
  try {
    const config = loadConfig();
    res.json({
      ports: {
        webUI: config.ports?.webUI || 19999,
        proxy: config.ports?.proxy || 20088,
        codexProxy: config.ports?.codexProxy || 20089,
        geminiProxy: config.ports?.geminiProxy || 20090,
        opencodeProxy: config.ports?.opencodeProxy || 20091
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
