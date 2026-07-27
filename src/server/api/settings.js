const express = require('express');
const router = express.Router();
const {
  MODEL_METADATA,
  METADATA_LAST_UPDATED,
  getDefaultSpeedTestModels,
  saveDefaultSpeedTestModels
} = require('../../config/model-metadata');
const { loadConfig, saveConfig } = require('../../config/loader');
const {
  MODEL_SCHEMA_VERSION,
  getPublicModelFieldSchema,
  isPlainObject,
  redactSensitiveFields,
  resolveModelDefinition,
  validateModelDefinitions
} = require('../services/model-definition-schema');

function mergeMetadata(base = {}, override = {}) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) result[key] = { ...result[key], ...value };
    else if (value !== undefined) result[key] = value;
  }
  return result;
}

function normalizeDefinitions(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value
      .filter(item => item && typeof item === 'object' && item.id)
      .map(item => [String(item.id), item]));
  }
  return isPlainObject(value) ? value : {};
}

function buildResolvedModelSettings(definitions, overrides) {
  const ids = new Set([
    ...Object.keys(MODEL_METADATA),
    ...Object.keys(overrides || {}),
    ...Object.keys(definitions || {})
  ]);
  const resolvedModels = {};
  const provenance = {};
  const warnings = {};
  for (const id of ids) {
    const stored = definitions[id] || {
      id,
      metadataMode: 'hybrid',
      overrides: overrides[id] || {}
    };
    const resolved = resolveModelDefinition(stored, { builtin: MODEL_METADATA[id] || {} });
    resolvedModels[id] = resolved.spec;
    provenance[id] = resolved.provenance;
    if (resolved.warnings.length > 0) warnings[id] = resolved.warnings;
  }
  return { resolvedModels, provenance, warnings };
}

function handleGetModelSettings(req, res) {
  try {
    const config = loadConfig();
    const overrides = config.modelMetadataOverrides || {};
    const definitions = normalizeDefinitions(config.modelDefinitions);
    const defaultSpeedTestModels = getDefaultSpeedTestModels();

    // Build merged table: built-in + user overrides
    const merged = {};
    for (const [id, meta] of Object.entries(MODEL_METADATA)) {
      merged[id] = overrides[id]
        ? mergeMetadata(meta, overrides[id])
        : meta;
    }

    // Also include any user-added custom models from overrides
    for (const [id, meta] of Object.entries(overrides)) {
      if (!merged[id]) {
        merged[id] = meta;
      }
    }

    const resolved = buildResolvedModelSettings(definitions, overrides);
    res.json({
      schemaVersion: MODEL_SCHEMA_VERSION,
      fieldSchema: getPublicModelFieldSchema(),
      models: redactSensitiveFields(merged),
      overrides: redactSensitiveFields(overrides),
      definitions: redactSensitiveFields(definitions),
      resolvedModels: redactSensitiveFields(resolved.resolvedModels),
      provenance: resolved.provenance,
      warnings: resolved.warnings,
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
    const { overrides, definitions, defaultSpeedTestModels } = req.body || {};
    if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides))) {
      return res.status(400).json({ error: 'overrides must be an object' });
    }

    // Validate each override entry
    if (overrides && typeof overrides === 'object') {
      for (const [modelId, meta] of Object.entries(overrides)) {
        if (typeof modelId !== 'string' || !modelId.trim()) {
          return res.status(400).json({ error: `Invalid model ID: "${modelId}"` });
        }
        if (!isPlainObject(meta)) {
          return res.status(400).json({ error: `${modelId}: metadata must be an object` });
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

    if (definitions !== undefined && !Array.isArray(definitions) && !isPlainObject(definitions)) {
      return res.status(400).json({ error: 'definitions must be an object or array' });
    }
    if (Array.isArray(definitions)) {
      const validation = validateModelDefinitions(definitions);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
    }
    const normalizedDefinitions = definitions === undefined ? undefined : normalizeDefinitions(definitions);
    if (normalizedDefinitions) {
      const definitionList = Object.entries(normalizedDefinitions).map(([id, definition]) => ({
        ...(isPlainObject(definition) ? definition : {}),
        id: isPlainObject(definition) && definition.id ? definition.id : id
      }));
      const validation = validateModelDefinitions(definitionList);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
    }

    const config = loadConfig();
    const newConfig = {
      ...config,
      modelMetadataOverrides: overrides && typeof overrides === 'object'
        ? overrides
        : (config.modelMetadataOverrides || {}),
      modelDefinitions: normalizedDefinitions === undefined
        ? (config.modelDefinitions || {})
        : normalizedDefinitions,
      modelMetadataSchemaVersion: MODEL_SCHEMA_VERSION
    };
    saveConfig(newConfig);
    const persistedDefaultSpeedTestModels = saveDefaultSpeedTestModels(defaultSpeedTestModels);

    res.json({
      success: true,
      schemaVersion: MODEL_SCHEMA_VERSION,
      overrides: redactSensitiveFields(newConfig.modelMetadataOverrides),
      definitions: redactSensitiveFields(newConfig.modelDefinitions),
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
