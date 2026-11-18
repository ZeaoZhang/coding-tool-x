'use strict';

const { normalizeModelSpec } = require('../server/services/model-definition-schema');
const { MODEL_METADATA, MODEL_ALIASES, METADATA_SOURCE } = require('../config/model-metadata');

/**
 * Shared model-definition helpers for CLI platforms whose native config
 * carries per-model metadata (context window, reasoning, input modalities).
 *
 * Channel storage keeps the author's raw definitions so platform-specific
 * fields (for example DSH `reasoningEfforts`) survive a round trip. Native
 * writers resolve each definition into the common channel schema and merge
 * catalog metadata as a fallback.
 */

const REASONING_EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const SUPPORTED_INPUT_TYPES = ['text', 'image'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function normalizeInputList(value) {
  if (!Array.isArray(value)) return undefined;
  const list = [...new Set(value
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => SUPPORTED_INPUT_TYPES.includes(item)))];
  return list.length > 0 ? list : undefined;
}

function normalizeReasoningEfforts(value) {
  if (value === false) return false;
  if (!isPlainObject(value)) return undefined;
  const efforts = {};
  for (const level of REASONING_EFFORT_LEVELS) {
    if (!Object.prototype.hasOwnProperty.call(value, level)) continue;
    const wire = value[level];
    if (wire === null) {
      // DSH only allows a valueless `off`; other levels must name their wire value.
      if (level === 'off') efforts.off = null;
      continue;
    }
    const text = String(wire ?? '').trim();
    if (text) efforts[level] = text;
  }
  return Object.keys(efforts).some(level => level !== 'off') ? efforts : undefined;
}

/**
 * Normalize channel-stored model definitions. Strings are promoted to
 * objects; duplicate ids merge with later fields winning. Unknown fields are
 * preserved for the platform's native config.
 */
function normalizeChannelModelDefinitions(models = []) {
  const result = [];
  const index = new Map();
  for (const value of Array.isArray(models) ? models : []) {
    const entry = typeof value === 'string'
      ? { id: value.trim() }
      : (isPlainObject(value) ? { ...value } : null);
    const id = String(entry?.id || entry?.name || '').trim();
    if (!id) continue;
    const key = id.toLowerCase();
    const existingIndex = index.get(key);
    if (existingIndex === undefined) {
      index.set(key, result.length);
      result.push({ ...entry, id });
      continue;
    }
    result[existingIndex] = { ...result[existingIndex], ...entry, id };
  }
  return result;
}

/**
 * Resolve one model definition into the shared channel schema
 * (id/name/reasoning/thinking/input/contextWindow/maxTokens/cost).
 * Explicit fields win over catalog metadata.
 */
function resolveChannelModelDefinition(value, catalogMeta = {}) {
  const raw = typeof value === 'string' ? { id: value } : (isPlainObject(value) ? value : {});
  const { spec } = normalizeModelSpec(raw, raw.id || raw.name);
  if (!spec?.id) return null;

  const catalog = isPlainObject(catalogMeta) ? catalogMeta : {};
  const catalogLimit = isPlainObject(catalog.limit) ? catalog.limit : {};
  const contextWindow = positiveNumber(spec.contextWindow ?? catalogLimit.context);
  const maxTokens = positiveNumber(spec.maxTokens ?? catalogLimit.output);
  const reasoning = typeof spec.reasoning === 'boolean'
    ? spec.reasoning
    : (typeof catalog.reasoning === 'boolean' ? catalog.reasoning : (spec.thinking ? true : undefined));
  const input = spec.input?.length ? spec.input : normalizeInputList(catalog.input);
  const reasoningEfforts = normalizeReasoningEfforts(raw.reasoningEfforts);

  return {
    ...spec,
    reasoning,
    input,
    contextWindow,
    maxTokens,
    reasoningEfforts
  };
}

function normalizeCatalogLookupKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const CATALOG_ENTRIES = Object.entries(MODEL_METADATA).map(([id, metadata]) => {
  const entryMetadata = isPlainObject(metadata) ? metadata : {};
  return {
    id,
    metadata: entryMetadata,
    normalizedName: normalizeCatalogLookupKey(entryMetadata.name)
  };
});
const CATALOG_ENTRY_BY_ID = new Map(CATALOG_ENTRIES.map(entry => [entry.id.toLowerCase(), entry]));
const CATALOG_ENTRY_BY_ALIAS = new Map();
for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
  const entry = CATALOG_ENTRY_BY_ID.get(String(canonical || '').toLowerCase());
  if (entry) CATALOG_ENTRY_BY_ALIAS.set(alias.toLowerCase(), entry);
}

function catalogModelId(value) {
  if (isPlainObject(value)) {
    return String(value.value || value.id || value.name || '').trim();
  }
  return String(value || '').trim();
}

function collectCatalogModelIds({
  model = '',
  speedTestModel = '',
  allowedModels = [],
  models = [],
  availableModels = []
} = {}) {
  const ids = [];
  const seen = new Set();
  for (const value of [
    model,
    speedTestModel,
    ...(Array.isArray(models) ? models : []),
    ...(Array.isArray(allowedModels) ? allowedModels : []),
    ...(Array.isArray(availableModels) ? availableModels : [])
  ]) {
    const id = catalogModelId(value);
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

function findCatalogEntryByDisplayName(requestedId) {
  const key = normalizeCatalogLookupKey(requestedId);
  if (!key) return null;
  const exact = CATALOG_ENTRIES.find(entry => entry.normalizedName === key);
  if (exact) return exact;
  // Catalog display names may carry a release suffix (for example
  // "DeepSeek V4.1 Flash 1017") while the runtime model ID omits it.
  const prefixed = CATALOG_ENTRIES.filter(entry => entry.normalizedName.startsWith(`${key}-`));
  return prefixed.length === 1 ? prefixed[0] : null;
}

function findCatalogEntry(requestedId) {
  const id = String(requestedId || '').trim().toLowerCase();
  if (!id) return null;
  return CATALOG_ENTRY_BY_ID.get(id)
    || CATALOG_ENTRIES.find(entry => String(entry.metadata.sourceId || '').toLowerCase() === id)
    || CATALOG_ENTRY_BY_ALIAS.get(id)
    || CATALOG_ENTRIES.find(entry => entry.id.split('/').pop().toLowerCase() === id)
    || findCatalogEntryByDisplayName(id)
    || null;
}

function catalogEntriesForTool(toolType) {
  const requested = String(toolType || '').trim().toLowerCase();
  if (!requested) return CATALOG_ENTRIES;
  return CATALOG_ENTRIES.filter(({ metadata }) => (
    Array.isArray(metadata.toolTypes) && metadata.toolTypes.includes(requested)
  ));
}

/**
 * Resolve offline Models.dev metadata for channel model selectors.
 *
 * Requested IDs win over the provider fallback. The operation only reads the
 * packaged snapshot: it never performs network or CLI discovery.
 */
function resolveChannelCatalogMetadata({
  toolType = '',
  providerKey = '',
  model = '',
  speedTestModel = '',
  allowedModels = [],
  models = [],
  availableModels = []
} = {}) {
  const requestedIds = collectCatalogModelIds({
    model,
    speedTestModel,
    allowedModels,
    models,
    availableModels
  });
  const eligibleEntries = catalogEntriesForTool(toolType);
  const provider = String(providerKey || '').trim().toLowerCase();
  const matchesProvider = entry => (
    String(entry.metadata.provider || '').toLowerCase() === provider
    || String(entry.metadata.sourceId || '').toLowerCase().startsWith(`${provider}/`)
  );

  const requestedEntries = requestedIds
    .map(requestedId => ({ entry: findCatalogEntry(requestedId), requestedId }))
    .filter(({ entry }) => Boolean(entry))
    .filter(({ entry, requestedId }) => eligibleEntries.includes(entry) && Boolean(requestedId));
  const providerEntries = provider
    ? eligibleEntries.filter(matchesProvider).map(entry => ({ entry, requestedId: '' }))
    : [];

  const entries = requestedIds.length > 0 ? requestedEntries : providerEntries;

  return {
    models: entries.map(({ entry, requestedId }) => ({
      ...structuredClone(entry.metadata),
      id: requestedId || entry.id
    })),
    warnings: [],
    source: { ...METADATA_SOURCE }
  };
}

module.exports = {
  SUPPORTED_INPUT_TYPES,
  normalizeChannelModelDefinitions,
  resolveChannelModelDefinition,
  resolveChannelCatalogMetadata
};
