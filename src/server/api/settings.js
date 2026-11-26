const express = require('express');
const router = express.Router();
const {
  MODEL_METADATA,
  METADATA_LAST_UPDATED,
  METADATA_SOURCE,
  getModelIdsByToolType,
  getDefaultSpeedTestModels
} = require('../../config/model-metadata');
const { getPlatformCatalog } = require('../services/platform-catalog');
const { getPlatformContext } = require('../platform-context');
const { loadConfig, saveConfig } = require('../../config/loader');
const {
  readOmpModelRoleSettings,
  updateOmpModelRoleSettings,
  readOmpFallbackChainsForUi,
  updateOmpFallbackChainsForUi
} = require('../../platforms/drivers/omp/model-role-settings');
const {
  readPlatformChains,
  writePlatformChains,
  listPlatformModelOptions
} = require('../../shared/model-fallback-store');
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

function normalizeSpeedTestModels(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, modelId]) => [String(key).trim(), typeof modelId === 'string' ? modelId.trim() : ''])
      .filter(([key, modelId]) => key && modelId)
  );
}

function getConfiguredChannelModels(platform) {
  try {
    const driver = getPlatformContext().runtime?.getDriver?.(platform, 'channels');
    const value = typeof driver?.list === 'function' ? driver.list({}) : null;
    if (!value || typeof value.then === 'function') return [];
    const data = value.status === 'ok' ? value.data : value;
    const channels = Array.isArray(data) ? data : (data?.channels || []);
    const models = new Set();
    for (const channel of channels) {
      if (typeof channel?.model === 'string' && channel.model.trim()) {
        models.add(channel.model.trim());
      }
      for (const item of Array.isArray(channel?.models) ? channel.models : []) {
        const modelId = typeof item === 'string' ? item : item?.id;
        if (typeof modelId === 'string' && modelId.trim()) models.add(modelId.trim());
      }
    }
    return [...models];
  } catch {
    return [];
  }
}

function getModelPlatformEntries(catalog = getPlatformCatalog()) {
  return catalog.list({ capability: 'channels', enabledOnly: false }).map(manifest => {
    const catalogKey = manifest.modelConfig?.catalogKey || manifest.key;
    const staticModels = getModelIdsByToolType(catalogKey);
    return {
      key: manifest.key,
      label: manifest.label || manifest.title || manifest.key,
      catalogKey,
      models: staticModels.length > 0 ? staticModels : getConfiguredChannelModels(manifest.key)
    };
  });
}

function resolveDefaultSpeedTestModels(config = {}, catalog = getPlatformCatalog(), platformEntries = null) {
  const configured = normalizeSpeedTestModels(config.defaultSpeedTestModels);
  const staticDefaults = normalizeSpeedTestModels(getDefaultSpeedTestModels());
  const entries = platformEntries || getModelPlatformEntries(catalog);
  return Object.fromEntries(entries.map(({ key, catalogKey, models }) => [
    key,
    configured[key]
      || configured[catalogKey]
      || staticDefaults[catalogKey]
      || staticDefaults[key]
      || models[0]
      || null
  ]));
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
    const catalog = getPlatformCatalog();
    const platformEntries = getModelPlatformEntries(catalog);
    const defaultSpeedTestModels = resolveDefaultSpeedTestModels(config, catalog, platformEntries);
    const toolModels = Object.fromEntries(platformEntries.map(({ key, models }) => [key, models]));

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
      metadataSource: METADATA_SOURCE,
      modelPlatforms: platformEntries,
      toolModels,
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
    if (defaultSpeedTestModels !== undefined && !isPlainObject(defaultSpeedTestModels)) {
      return res.status(400).json({ error: 'defaultSpeedTestModels must be an object' });
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
          if (!isPlainObject(meta.limit)) {
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
          if (!isPlainObject(meta.pricing)) {
            return res.status(400).json({ error: `${modelId}: pricing must be an object` });
          }
          for (const field of ['input', 'output', 'cacheCreation', 'cacheRead']) {
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
    const catalog = getPlatformCatalog();
    const persistedDefaultSpeedTestModels = {
      ...normalizeSpeedTestModels(getDefaultSpeedTestModels()),
      ...normalizeSpeedTestModels(config.defaultSpeedTestModels),
      ...normalizeSpeedTestModels(defaultSpeedTestModels)
    };
    const newConfig = {
      ...config,
      modelMetadataOverrides: overrides && typeof overrides === 'object'
        ? overrides
        : (config.modelMetadataOverrides || {}),
      modelDefinitions: normalizedDefinitions === undefined
        ? (config.modelDefinitions || {})
        : normalizedDefinitions,
      defaultSpeedTestModels: persistedDefaultSpeedTestModels,
      modelMetadataSchemaVersion: MODEL_SCHEMA_VERSION
    };
    saveConfig(newConfig);

    res.json({
      success: true,
      schemaVersion: MODEL_SCHEMA_VERSION,
      overrides: redactSensitiveFields(newConfig.modelMetadataOverrides),
      definitions: redactSensitiveFields(newConfig.modelDefinitions),
      defaultSpeedTestModels: resolveDefaultSpeedTestModels(newConfig, catalog)
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

router.get('/omp-model-roles', (req, res) => {
  try {
    res.json({ success: true, ...readOmpModelRoleSettings() });
  } catch (error) {
    console.error('Error getting OMP model roles:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/omp-model-roles', (req, res) => {
  try {
    const { roles } = req.body || {};
    if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
      return res.status(400).json({ error: 'roles must be an object' });
    }
    res.json({ success: true, ...updateOmpModelRoleSettings(roles) });
  } catch (error) {
    console.error('Error saving OMP model roles:', error);
    const isValidationError = /^roles(?:\.| must be)/.test(error.message);
    res.status(isValidationError ? 400 : 500).json({ error: error.message });
  }
});

// ── 平台级「模型回退链」（Agent 面板配置；OMP 写它自己的 config.yml）──
const FALLBACK_CONTROL_PLATFORMS = new Set(['claude', 'codex', 'gemini', 'opencode', 'dsh', 'omp']);

function normalizeFallbackPlatform(value) {
  return String(value || '').trim().toLowerCase();
}

function readEnabledPlatformChannels(platform) {
  const driver = getPlatformCatalog().driver(platform, 'channels');
  const result = driver?.getEnabled?.();
  if (!result || result.status !== 'ok') return [];
  return Array.isArray(result.data)
    ? result.data
    : (Array.isArray(result.data?.channels) ? result.data.channels : []);
}

function assertFallbackChainsPayload(chains, channels) {
  if (!Array.isArray(chains)) throw new Error('chains must be an array');
  const byId = new Map(channels.map(channel => [channel.id, channel]));
  for (const rule of chains) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error('chains[] must be an object');
    }
    const from = String(rule.from || '').trim();
    if (!from) throw new Error('chains[].from must be a non-empty string');
    if (from.length > 200) throw new Error('chains[].from must be 200 characters or fewer');
    if (!Array.isArray(rule.targets) || rule.targets.length === 0) {
      throw new Error(`chains.${from}.targets must be a non-empty array`);
    }
    if (rule.targets.length > 5) throw new Error(`chains.${from} supports at most 5 fallback models`);
    for (const target of rule.targets) {
      const channelId = String(target?.channelId || '').trim();
      const model = String(target?.model || '').trim();
      if (!channelId) throw new Error(`chains.${from} targets must include a channelId`);
      if (!model) throw new Error(`chains.${from} targets must include a model`);
      if (!byId.has(channelId)) throw new Error(`chains.${from} references a channel that is not enabled`);
      const channel = byId.get(channelId);
      const declared = [
        ...(Array.isArray(channel.models) ? channel.models : []),
        ...(Array.isArray(channel.allowedModels) ? channel.allowedModels : []),
        channel.model
      ].map(item => String(typeof item === 'string' ? item : (item?.id || item?.name || '')).trim()).filter(Boolean);
      if (declared.length > 0 && !declared.includes(model)) {
        throw new Error(`chains.${from} model "${model}" is not declared by channel "${channel.name || channelId}"`);
      }
    }
  }
}

router.get('/model-fallback-chains', (req, res) => {
  const platform = normalizeFallbackPlatform(req.query?.platform);
  if (!FALLBACK_CONTROL_PLATFORMS.has(platform)) {
    return res.status(400).json({ error: `platform must be one of ${[...FALLBACK_CONTROL_PLATFORMS].join(', ')}` });
  }
  try {
    if (platform === 'omp') {
      return res.json({ success: true, platform, ...readOmpFallbackChainsForUi() });
    }
    const channels = readEnabledPlatformChannels(platform);
    res.json({
      success: true,
      platform,
      chains: readPlatformChains(platform),
      modelOptions: listPlatformModelOptions(channels)
    });
  } catch (error) {
    console.error('Error getting model fallback chains:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/model-fallback-chains', (req, res) => {
  const platform = normalizeFallbackPlatform(req.body?.platform || req.query?.platform);
  if (!FALLBACK_CONTROL_PLATFORMS.has(platform)) {
    return res.status(400).json({ error: `platform must be one of ${[...FALLBACK_CONTROL_PLATFORMS].join(', ')}` });
  }
  const { chains } = req.body || {};
  if (!Array.isArray(chains)) {
    return res.status(400).json({ error: 'chains must be an array' });
  }
  try {
    const channels = readEnabledPlatformChannels(platform);
    assertFallbackChainsPayload(chains, channels);
    if (platform === 'omp') {
      return res.json({ success: true, platform, ...updateOmpFallbackChainsForUi(chains) });
    }
    res.json({
      success: true,
      platform,
      chains: writePlatformChains(platform, chains),
      modelOptions: listPlatformModelOptions(channels)
    });
  } catch (error) {
    console.error('Error saving model fallback chains:', error);
    const isValidationError = /^chains(\.|\[\]| must be| )/.test(error.message);
    res.status(isValidationError ? 400 : 500).json({ error: error.message });
  }
});

module.exports = router;
