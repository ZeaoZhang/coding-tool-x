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
  codex: 'gpt-5.2',
  gemini: 'gemini-2.5-pro'
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
 * Supports: exact match -> alias match -> prefix match -> generic Claude fallback
 *
 * @param {string} modelId
 * @returns {{ limit: {context, output}, pricing: {input, output, cacheCreation?, cacheRead?} } | null}
 */
function resolveModelMetadata(modelId) {
  if (!modelId) return null;
  const id = String(modelId).toLowerCase().trim();

  // Exact match
  for (const [key, meta] of Object.entries(MODEL_METADATA)) {
    if (id === key.toLowerCase()) return meta;
  }

  // Alias match -> canonical
  for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
    if (id === alias.toLowerCase()) {
      const meta = MODEL_METADATA[canonical];
      if (meta) return meta;
    }
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

function getDefaultModels() {
  return {
    claude: [...(DEFAULT_MODELS.claude || [])],
    codex: [...(DEFAULT_MODELS.codex || [])],
    gemini: [...(DEFAULT_MODELS.gemini || [])]
  };
}

function getDefaultModelsByToolType(toolType) {
  const key = String(toolType || '').trim().toLowerCase();
  if (key === 'openai_compatible') return [...(DEFAULT_MODELS.codex || [])];
  if (key === 'claude' || key === 'codex' || key === 'gemini') {
    return [...(DEFAULT_MODELS[key] || [])];
  }
  return [];
}

function getDefaultSpeedTestModels() {
  const fileConfig = loadMetadataConfigFromFile();
  const raw = fileConfig.defaultSpeedTestModels || DEFAULT_SPEED_TEST_MODELS;
  return {
    claude: normalizeNonEmptyString(raw.claude) || DEFAULT_SPEED_TEST_MODELS.claude,
    codex: normalizeNonEmptyString(raw.codex) || DEFAULT_SPEED_TEST_MODELS.codex,
    gemini: normalizeNonEmptyString(raw.gemini) || DEFAULT_SPEED_TEST_MODELS.gemini
  };
}

function getDefaultSpeedTestModelByToolType(toolType) {
  const key = String(toolType || '').trim().toLowerCase();
  const defaults = getDefaultSpeedTestModels();
  if (key === 'openai_compatible') return defaults.codex;
  if (key === 'claude' || key === 'codex' || key === 'gemini') {
    return defaults[key];
  }
  return defaults.codex;
}

function saveDefaultSpeedTestModels(nextDefaults) {
  const current = loadMetadataConfigFromFile();
  const merged = {
    ...getDefaultSpeedTestModels(),
    ...(nextDefaults || {})
  };

  const normalized = {
    claude: normalizeNonEmptyString(merged.claude) || DEFAULT_SPEED_TEST_MODELS.claude,
    codex: normalizeNonEmptyString(merged.codex) || DEFAULT_SPEED_TEST_MODELS.codex,
    gemini: normalizeNonEmptyString(merged.gemini) || DEFAULT_SPEED_TEST_MODELS.gemini
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
  getDefaultModels,
  getDefaultModelsByToolType,
  getDefaultSpeedTestModels,
  getDefaultSpeedTestModelByToolType,
  saveDefaultSpeedTestModels,
  METADATA_LAST_UPDATED: metadataConfig.lastUpdated || '2026-02-27'
};
