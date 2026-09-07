/**
 * Model metadata runtime helpers.
 * Data source: ./model-metadata.json
 */

const fs = require('fs');
const path = require('path');
const metadataConfig = require('./model-metadata.json');
const METADATA_FILE_PATH = path.join(__dirname, 'model-metadata.json');

const MODEL_METADATA = metadataConfig.models || {};
const MODEL_ALIASES = metadataConfig.aliases || {};
const DEFAULT_MODELS = metadataConfig.defaultModels || { claude: [], codex: [], gemini: [] };
const DEFAULT_SPEED_TEST_MODELS = metadataConfig.defaultSpeedTestModels || {
  claude: 'claude-haiku-4-5',
  codex: 'gpt-5.4',
  gemini: 'gemini-2.5-pro'
};
const METADATA_LAST_UPDATED = metadataConfig.lastUpdated || '2026-03-06';
const METADATA_SOURCE = {
  name: metadataConfig.source || 'models.dev',
  url: metadataConfig.sourceUrl || 'https://models.dev/api.json',
  lastUpdated: METADATA_LAST_UPDATED
};

function normalizeNonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function loadMetadataConfigFromFile() {
  try {
    const raw = fs.readFileSync(METADATA_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    console.warn(`[model-metadata] Failed to read metadata file, fallback to in-memory config: ${error.message}`);
  }
  return metadataConfig;
}

/**
 * Resolve model metadata (limit + pricing) for a given model ID.
 * Supports: alias match -> exact match -> prefix match -> generic Claude fallback
 *
 * @param {string} modelId
 * @returns {{ limit: {context, output}, pricing: {input, output, cacheCreation?, cacheRead?} } | null}
 */
function resolveModelMetadata(modelId) {
  if (!modelId) return null;
  const id = String(modelId).toLowerCase().trim();

  // Alias match preserves legacy IDs even when the source also lists them.
  for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
    if (id === alias.toLowerCase()) {
      const meta = MODEL_METADATA[canonical];
      if (meta) return meta;
    }
  }

  // Exact match
  for (const [key, meta] of Object.entries(MODEL_METADATA)) {
    if (id === key.toLowerCase()) return meta;
  }

  // Prefix match
  for (const [key, meta] of Object.entries(MODEL_METADATA)) {
    if (id.startsWith(key.toLowerCase())) return meta;
  }

  // Generic fallback for unknown Claude models
  if (id.startsWith('claude-')) {
    return {
      limit: { context: 200000, output: 32000 },
      pricing: { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 }
    };
  }

  return null;
}

function resolveModelLimit(modelId) {
  const meta = resolveModelMetadata(modelId);
  return meta ? meta.limit : null;
}

function resolveModelPricing(modelId) {
  const meta = resolveModelMetadata(modelId);
  return meta ? meta.pricing : null;
}

function getAllModelIds() {
  return Object.keys(MODEL_METADATA);
}

function getModelIdsByToolType(toolType) {
  const requested = String(toolType || '').trim().toLowerCase();
  const key = requested === 'openai_compatible' ? 'opencode' : requested;
  if (!key) return [];

  return Object.entries(MODEL_METADATA)
    .filter(([id, meta]) => {
      if (Array.isArray(meta.toolTypes)) return meta.toolTypes.includes(key);
      if (key === 'claude') return id.toLowerCase().startsWith('claude-');
      if (key === 'codex') return /^(gpt-|o[134](?:-|$))/i.test(id);
      if (key === 'gemini') return id.toLowerCase().startsWith('gemini-');
      return false;
    })
    .map(([id]) => id);
}

function getDefaultModels() {
  return Object.fromEntries(Object.entries(DEFAULT_MODELS).map(([key, models]) => [
    key,
    Array.isArray(models) ? [...models] : []
  ]));
}

function getDefaultModelsByToolType(toolType) {
  const key = String(toolType || '').trim().toLowerCase();
  const alias = key === 'openai_compatible' ? 'codex' : key;
  return Array.isArray(DEFAULT_MODELS[alias]) ? [...DEFAULT_MODELS[alias]] : [];
}

function getDefaultSpeedTestModels() {
  const fileConfig = loadMetadataConfigFromFile();
  const raw = fileConfig.defaultSpeedTestModels || DEFAULT_SPEED_TEST_MODELS;
  return Object.fromEntries(Object.entries({
    ...DEFAULT_SPEED_TEST_MODELS,
    ...raw
  }).map(([key, value]) => [key, normalizeNonEmptyString(value) || value]));
}

function getDefaultSpeedTestModelByToolType(toolType) {
  const key = String(toolType || '').trim().toLowerCase();
  const alias = key === 'openai_compatible' ? 'codex' : key;
  const defaults = getDefaultSpeedTestModels();
  return defaults[alias] || defaults.codex || null;
}

function saveDefaultSpeedTestModels(nextDefaults) {
  const current = loadMetadataConfigFromFile();
  const normalized = {
    ...getDefaultSpeedTestModels(),
    ...(nextDefaults || {})
  };
  const nextConfig = {
    ...current,
    defaultSpeedTestModels: normalized
  };
  fs.writeFileSync(METADATA_FILE_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
  metadataConfig.defaultSpeedTestModels = normalized;
  return normalized;
}

module.exports = {
  MODEL_METADATA,
  MODEL_ALIASES,
  DEFAULT_MODELS,
  DEFAULT_SPEED_TEST_MODELS,
  resolveModelMetadata,
  resolveModelLimit,
  resolveModelPricing,
  getAllModelIds,
  getModelIdsByToolType,
  getDefaultModels,
  getDefaultModelsByToolType,
  getDefaultSpeedTestModels,
  getDefaultSpeedTestModelByToolType,
  saveDefaultSpeedTestModels,
  METADATA_LAST_UPDATED,
  METADATA_SOURCE
};
