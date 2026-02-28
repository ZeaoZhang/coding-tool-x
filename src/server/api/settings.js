const express = require('express');
const router = express.Router();
const { detectAvailableTerminals } = require('../services/terminal-detector');
const { loadTerminalConfig, saveTerminalConfig, getSelectedTerminal } = require('../services/terminal-config');
const {
  MODEL_METADATA,
  METADATA_LAST_UPDATED,
  getDefaultSpeedTestModels,
  saveDefaultSpeedTestModels
} = require('../../config/model-metadata');
const { loadConfig, saveConfig } = require('../../config/loader');

// GET /api/settings/terminals - 获取可用终端列表
router.get('/terminals', (req, res) => {
  try {
    const availableTerminals = detectAvailableTerminals();
    const config = loadTerminalConfig();

    res.json({
      available: availableTerminals,
      selected: config.selectedTerminal,
      customCommand: config.customCommand
    });
  } catch (error) {
    console.error('Error getting terminals:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/settings/terminal-config - 获取当前终端配置
router.get('/terminal-config', (req, res) => {
  try {
    const config = loadTerminalConfig();
    const selectedTerminal = getSelectedTerminal();

    res.json({
      config,
      selectedTerminal
    });
  } catch (error) {
    console.error('Error getting terminal config:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/terminal-config - 保存终端配置
router.post('/terminal-config', (req, res) => {
  try {
    const { selectedTerminal, customCommand } = req.body;

    const config = {
      selectedTerminal: selectedTerminal || null,
      customCommand: customCommand || null
    };

    saveTerminalConfig(config);

    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error saving terminal config:', error);
    res.status(500).json({ error: error.message });
  }
});

function handleGetModelSettings(req, res) {
  try {
    const config = loadConfig();
    const overrides = config.modelMetadataOverrides || {};
    const defaultSpeedTestModels = getDefaultSpeedTestModels();

    // Build merged table: built-in + user overrides
    const merged = {};
    for (const [id, meta] of Object.entries(MODEL_METADATA)) {
      merged[id] = overrides[id]
        ? {
          limit: { ...meta.limit, ...(overrides[id].limit || {}) },
          pricing: { ...meta.pricing, ...(overrides[id].pricing || {}) }
        }
        : meta;
    }

    // Also include any user-added custom models from overrides
    for (const [id, meta] of Object.entries(overrides)) {
      if (!merged[id]) {
        merged[id] = meta;
      }
    }

    res.json({
      models: merged,
      overrides,
      builtinModelIds: Object.keys(MODEL_METADATA),
      lastUpdated: METADATA_LAST_UPDATED,
      defaultSpeedTestModels
    });
  } catch (error) {
    console.error('Error getting model metadata:', error);
    res.status(500).json({ error: error.message });
  }
}

// GET /api/settings/model-settings - 获取模型设置（元数据 + 默认测速模型）
router.get('/model-settings', handleGetModelSettings);
// backward compatibility
router.get('/model-metadata', handleGetModelSettings);

function handleSaveModelSettings(req, res) {
  try {
    const { overrides, defaultSpeedTestModels } = req.body || {};
    if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides))) {
      return res.status(400).json({ error: 'overrides must be an object' });
    }

    // Validate each override entry
    if (overrides && typeof overrides === 'object') {
      for (const [modelId, meta] of Object.entries(overrides)) {
        if (typeof modelId !== 'string' || !modelId.trim()) {
          return res.status(400).json({ error: `Invalid model ID: "${modelId}"` });
        }
        if (meta.limit !== undefined) {
          if (typeof meta.limit !== 'object') {
            return res.status(400).json({ error: `${modelId}: limit must be an object` });
          }
          if (meta.limit.context !== undefined && (typeof meta.limit.context !== 'number' || meta.limit.context <= 0)) {
            return res.status(400).json({ error: `${modelId}: limit.context must be a positive number` });
          }
          if (meta.limit.output !== undefined && (typeof meta.limit.output !== 'number' || meta.limit.output <= 0)) {
            return res.status(400).json({ error: `${modelId}: limit.output must be a positive number` });
          }
        }
        if (meta.pricing !== undefined) {
          if (typeof meta.pricing !== 'object') {
            return res.status(400).json({ error: `${modelId}: pricing must be an object` });
          }
          for (const field of ['input', 'output']) {
            if (meta.pricing[field] !== undefined && (typeof meta.pricing[field] !== 'number' || meta.pricing[field] < 0)) {
              return res.status(400).json({ error: `${modelId}: pricing.${field} must be a non-negative number` });
            }
          }
        }
      }
    }

    const config = loadConfig();
    const newConfig = {
      ...config,
      projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
      modelMetadataOverrides: overrides && typeof overrides === 'object'
        ? overrides
        : (config.modelMetadataOverrides || {})
    };
    saveConfig(newConfig);
    const persistedDefaultSpeedTestModels = saveDefaultSpeedTestModels(defaultSpeedTestModels);

    res.json({
      success: true,
      overrides: newConfig.modelMetadataOverrides,
      defaultSpeedTestModels: persistedDefaultSpeedTestModels
    });
  } catch (error) {
    console.error('Error saving model metadata:', error);
    res.status(500).json({ error: error.message });
  }
}

// POST /api/settings/model-settings - 保存模型设置
router.post('/model-settings', handleSaveModelSettings);
// backward compatibility
router.post('/model-metadata', handleSaveModelSettings);

// DELETE /api/settings/model-metadata/:modelId - 删除单个模型覆盖项（恢复内置默认值）
function handleDeleteModelOverride(req, res) {
  try {
    const modelId = decodeURIComponent(req.params.modelId);
    const config = loadConfig();
    const overrides = { ...(config.modelMetadataOverrides || {}) };
    delete overrides[modelId];

    const newConfig = {
      ...config,
      projectsDir: config.projectsDir.replace(require('os').homedir(), '~'),
      modelMetadataOverrides: overrides
    };
    saveConfig(newConfig);

    res.json({ success: true, modelId });
  } catch (error) {
    console.error('Error deleting model metadata override:', error);
    res.status(500).json({ error: error.message });
  }
}

router.delete('/model-settings/:modelId', handleDeleteModelOverride);
router.delete('/model-metadata/:modelId', handleDeleteModelOverride);

module.exports = router;
