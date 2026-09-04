'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const policy = require('./model-catalog-policy.json');

const SOURCE_URL = 'https://models.dev/api.json';
const SNAPSHOT_PATH = path.join(__dirname, '..', 'src', 'config', 'model-metadata.json');
const REPORT_PATH = process.env.MODEL_CATALOG_REPORT_PATH
  || path.join(os.tmpdir(), 'model-catalog-sync-report.md');
const FETCH_TIMEOUT_MS = 30_000;
const NATIVE_TOOL_TYPES = ['claude', 'codex', 'gemini'];
const SUPPORTED_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
const EXPIRED_STATUSES = new Set(['deprecated', 'expired']);
const KNOWN_COST_FIELDS = new Set(['input', 'output', 'cache_read', 'cache_write']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function compareStrings(left, right) {
  return String(left).localeCompare(String(right), 'en', { sensitivity: 'base' });
}

function sortObjectByKey(value) {
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value)
    .sort(compareStrings)
    .map(key => [key, sortObjectByKey(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(sortObjectByKey(value));
}

function validateSourcePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error('Models.dev payload must be an object with provider models');
  }

  let providerCount = 0;
  for (const [providerId, provider] of Object.entries(payload)) {
    if (!isPlainObject(provider) || !Object.prototype.hasOwnProperty.call(provider, 'models')) continue;
    providerCount += 1;
    if (!isPlainObject(provider.models)) {
      throw new Error(`${providerId}.models must be an object`);
    }

    for (const [modelKey, model] of Object.entries(provider.models)) {
      if (!isPlainObject(model)) {
        throw new Error(`${providerId}/${modelKey} model entry must be an object`);
      }
      if (!normalizeString(model.id)) {
        throw new Error(`${providerId}/${modelKey} model id must be a non-empty string`);
      }
    }
  }

  if (providerCount === 0) {
    throw new Error('Models.dev payload must contain provider models');
  }

  return true;
}

function compilePatterns(patterns = []) {
  return (Array.isArray(patterns) ? patterns : [])
    .map(pattern => {
      try {
        return new RegExp(String(pattern));
      } catch (error) {
        throw new Error(`Invalid model policy pattern ${String(pattern)}: ${error.message}`);
      }
    });
}

function matchesPolicy(modelId, rule) {
  const patterns = compilePatterns(rule?.modelPatterns);
  return patterns.length === 0 || patterns.some(pattern => pattern.test(modelId));
}

function getModalities(model) {
  const modalities = isPlainObject(model.modalities) ? model.modalities : {};
  const input = Array.isArray(modalities.input)
    ? modalities.input
      .map(value => normalizeString(value).toLowerCase())
      .filter(value => value === 'text' || value === 'image')
    : [];
  const output = Array.isArray(modalities.output)
    ? modalities.output.map(value => normalizeString(value).toLowerCase()).filter(Boolean)
    : [];
  return { input, output };
}

function getEfforts(model) {
  const candidate = model.reasoning_effort ?? model.reasoning_efforts ?? model.reasoningEffort;
  const values = Array.isArray(candidate) ? candidate : [candidate];
  const efforts = [...new Set(values
    .map(value => normalizeString(value).toLowerCase())
    .filter(value => SUPPORTED_EFFORTS.has(value)))];
  return efforts;
}

function getIgnoredCostFields(cost) {
  return Object.keys(cost || {}).filter(key => !KNOWN_COST_FIELDS.has(key));
}

function getPreviousReferences(previousSnapshot) {
  const references = new Set();
  const models = isPlainObject(previousSnapshot?.models) ? previousSnapshot.models : {};
  Object.keys(models).forEach(id => references.add(String(id).toLowerCase()));
  const aliases = isPlainObject(previousSnapshot?.aliases) ? previousSnapshot.aliases : {};
  Object.entries(aliases).forEach(([alias, canonical]) => {
    references.add(String(alias).toLowerCase());
    references.add(String(canonical).toLowerCase());
  });
  for (const values of Object.values(previousSnapshot?.defaultModels || {})) {
    if (Array.isArray(values)) values.forEach(id => references.add(String(id).toLowerCase()));
  }
  for (const id of Object.values(previousSnapshot?.defaultSpeedTestModels || {})) {
    references.add(String(id).toLowerCase());
  }
  return references;
}

function normalizeModel(providerId, rule, model, rawModelId, warnings) {
  const modelId = normalizeString(model.id || rawModelId);
  const sourceId = `${providerId}/${modelId}`;
  const runtimeId = rule.runtimeMode === 'compatible' ? sourceId : modelId;
  const modalities = getModalities(model);
  const limit = isPlainObject(model.limit) ? model.limit : {};
  const cost = isPlainObject(model.cost) ? model.cost : {};

  if (!modalities.input.includes('text') || !modalities.output.includes('text')) {
    warnings.push(`${sourceId}: excluded because it is not a text-to-text model`);
    return null;
  }
  if (model.tool_call === false) {
    warnings.push(`${sourceId}: excluded because tool_call is false`);
    return null;
  }
  if (!isFiniteNumber(limit.context) || limit.context <= 0
    || !isFiniteNumber(limit.output) || limit.output <= 0) {
    warnings.push(`${sourceId}: excluded because context/output limits are invalid`);
    return null;
  }
  if (!isFiniteNumber(cost.input) || cost.input < 0
    || !isFiniteNumber(cost.output) || cost.output < 0) {
    warnings.push(`${sourceId}: excluded because input/output cost is missing or invalid`);
    return null;
  }

  const efforts = getEfforts(model);
  const output = {
    id: runtimeId,
    sourceId,
    provider: providerId,
    toolTypes: [...(Array.isArray(rule.toolTypes) ? rule.toolTypes : [])],
    limit: {
      context: limit.context,
      output: limit.output
    },
    pricing: {
      input: cost.input,
      output: cost.output
    }
  };

  const name = normalizeString(model.name);
  if (name) output.name = name;
  if (typeof model.reasoning === 'boolean') output.reasoning = model.reasoning;
  if (modalities.input.length > 0) output.input = modalities.input;
  if (typeof model.tool_call === 'boolean') output.supportsTools = model.tool_call;
  if (efforts.length > 0) {
    output.thinking = {
      mode: 'effort',
      efforts
    };
  }
  if (isFiniteNumber(cost.cache_read) && cost.cache_read >= 0) {
    output.pricing.cacheRead = cost.cache_read;
  }
  if (isFiniteNumber(cost.cache_write) && cost.cache_write >= 0) {
    output.pricing.cacheCreation = cost.cache_write;
  }
  const ignoredCostFields = getIgnoredCostFields(cost);
  if (ignoredCostFields.length > 0) {
    warnings.push(`${sourceId}: unsupported cost fields use base prices (${ignoredCostFields.join(', ')})`);
  }

  return {
    id: runtimeId,
    metadata: output,
    sourceId,
    runtimeId,
    rawModelId: modelId,
    runtimeMode: rule.runtimeMode,
    lastUpdated: normalizeString(model.last_updated || model.lastUpdated)
  };
}

function modelIsEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

const LEGACY_RUNTIME_FIELDS = ['reasoning', 'thinking', 'input', 'supportsTools'];

function preserveLegacyRuntimeFields(metadata, previousModels, runtimeId) {
  const previousId = Object.keys(previousModels || {}).find(id => id.toLowerCase() === runtimeId.toLowerCase());
  const previous = previousId ? previousModels[previousId] : null;
  if (!isPlainObject(previous)) return metadata;

  const result = { ...metadata };
  for (const field of LEGACY_RUNTIME_FIELDS) {
    if (result[field] === undefined && previous[field] !== undefined) {
      result[field] = clone(previous[field]);
    }
  }
  return result;
}

function buildNativeDefaults(previousSnapshot, selectedRecords, allModels) {
  const previousDefaults = isPlainObject(previousSnapshot?.defaultModels)
    ? previousSnapshot.defaultModels
    : {};
  const defaults = {};

  for (const toolType of NATIVE_TOOL_TYPES) {
    const retained = Array.isArray(previousDefaults[toolType])
      ? previousDefaults[toolType].filter(id => Object.prototype.hasOwnProperty.call(allModels, id))
      : [];
    const seen = new Set(retained.map(id => String(id).toLowerCase()));
    const generated = selectedRecords
      .filter(record => record.runtimeMode === 'direct' && record.metadata.toolTypes.includes(toolType))
      .sort((left, right) => {
        const dateOrder = right.lastUpdated.localeCompare(left.lastUpdated);
        return dateOrder || compareStrings(left.runtimeId, right.runtimeId);
      })
      .map(record => record.runtimeId)
      .filter(id => {
        const key = String(id).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    defaults[toolType] = [...retained, ...generated];
  }

  return defaults;
}

function buildSpeedTestDefaults(previousSnapshot, defaultModels, allModels) {
  const previous = isPlainObject(previousSnapshot?.defaultSpeedTestModels)
    ? previousSnapshot.defaultSpeedTestModels
    : {};
  const defaults = {};
  for (const toolType of NATIVE_TOOL_TYPES) {
    const previousModel = normalizeString(previous[toolType]);
    if (previousModel && Object.prototype.hasOwnProperty.call(allModels, previousModel)) {
      defaults[toolType] = previousModel;
      continue;
    }
    defaults[toolType] = defaultModels[toolType][0] || '';
  }
  return defaults;
}

function buildAliases(previousSnapshot, selectedRecords, allModels) {
  const aliases = isPlainObject(previousSnapshot?.aliases) ? clone(previousSnapshot.aliases) : {};
  for (const record of selectedRecords) {
    if (record.runtimeMode !== 'compatible') continue;
    const shortId = record.rawModelId;
    const lowerShortId = shortId.toLowerCase();
    const existingModelId = Object.keys(allModels).some(id => id.toLowerCase() === lowerShortId);
    const existingAlias = Object.keys(aliases).some(alias => alias.toLowerCase() === lowerShortId);
    if (!existingModelId && !existingAlias) aliases[shortId] = record.runtimeId;
  }
  return aliases;
}

function collectChanges(previousModels, selectedModels, retainedIds) {
  const added = [];
  const updated = [];
  const priceChanged = [];
  const limitChanged = [];

  for (const [id, metadata] of Object.entries(selectedModels)) {
    const previous = previousModels[id];
    if (!previous) {
      added.push(id);
      continue;
    }
    if (!modelIsEqual(previous, metadata)) updated.push(id);
    if (!modelIsEqual(previous.pricing, metadata.pricing)) priceChanged.push(id);
    if (!modelIsEqual(previous.limit, metadata.limit)) limitChanged.push(id);
  }

  return {
    added: added.sort(compareStrings),
    updated: updated.sort(compareStrings),
    removed: [...retainedIds].sort(compareStrings),
    priceChanged: priceChanged.sort(compareStrings),
    limitChanged: limitChanged.sort(compareStrings)
  };
}

function validateSnapshot(snapshot, {
  selectedCount = 0,
  previousCount = 0,
  minimumModelCount = 1
} = {}) {
  if (!isPlainObject(snapshot) || !isPlainObject(snapshot.models)) {
    throw new Error('generated snapshot must contain a models object');
  }
  if (selectedCount <= 0) {
    throw new Error('generated model catalog is empty or abnormal');
  }
  if (selectedCount < minimumModelCount) {
    throw new Error(`generated model catalog is below minimum count ${minimumModelCount}`);
  }
  if (previousCount > 0 && selectedCount < Math.max(1, Math.floor(previousCount / 2))) {
    throw new Error(`generated model catalog is abnormal: ${selectedCount} selected versus ${previousCount} previously published`);
  }

  const metadataIds = new Set();
  for (const [id, metadata] of Object.entries(snapshot.models)) {
    if (!isPlainObject(metadata)) throw new Error(`${id}: generated metadata must be an object`);
    const metadataId = normalizeString(metadata.id) || id;
    const lowerMetadataId = metadataId.toLowerCase();
    if (metadataIds.has(lowerMetadataId)) {
      throw new Error(`duplicate runtime model id: ${metadataId}`);
    }
    metadataIds.add(lowerMetadataId);

    if (metadata.limit !== undefined) {
      if (!isPlainObject(metadata.limit)
        || !isFiniteNumber(metadata.limit.context) || metadata.limit.context <= 0
        || !isFiniteNumber(metadata.limit.output) || metadata.limit.output <= 0) {
        throw new Error(`${id}: generated limits must be positive numbers`);
      }
    }
    if (metadata.pricing !== undefined) {
      if (!isPlainObject(metadata.pricing)) throw new Error(`${id}: generated pricing must be an object`);
      for (const field of ['input', 'output', 'cacheRead', 'cacheCreation']) {
        if (metadata.pricing[field] !== undefined
          && (!isFiniteNumber(metadata.pricing[field]) || metadata.pricing[field] < 0)) {
          throw new Error(`${id}: generated pricing.${field} must be non-negative`);
        }
      }
    }
  }

  return true;
}

function buildSnapshot(payload, {
  policy: selectedPolicy = policy,
  previousSnapshot = {},
  updatedAt = new Date().toISOString().slice(0, 10)
} = {}) {
  validateSourcePayload(payload);
  if (!isPlainObject(selectedPolicy) || !isPlainObject(selectedPolicy.providers)) {
    throw new Error('model catalog policy must contain providers');
  }

  const warnings = [];
  const selectedModels = {};
  const selectedRecords = [];
  const previousModels = isPlainObject(previousSnapshot?.models) ? previousSnapshot.models : {};
  const previousReferences = getPreviousReferences(previousSnapshot);
  const runtimeSources = new Map();

  for (const [providerId, rule] of Object.entries(selectedPolicy.providers)) {
    const provider = payload[providerId];
    if (!isPlainObject(provider) || !isPlainObject(provider.models)) continue;
    for (const [rawModelId, model] of Object.entries(provider.models)) {
      const sourceModelId = `${providerId}/${normalizeString(model.id || rawModelId)}`;
      if (!matchesPolicy(normalizeString(model.id || rawModelId), rule)) continue;

      const status = normalizeString(model.status).toLowerCase();
      const runtimeMode = rule.runtimeMode === 'compatible' ? 'compatible' : 'direct';
      const candidateRuntimeId = runtimeMode === 'compatible'
        ? sourceModelId
        : normalizeString(model.id || rawModelId);
      if (EXPIRED_STATUSES.has(status)
        && !previousReferences.has(candidateRuntimeId.toLowerCase())
        && !previousReferences.has(sourceModelId.toLowerCase())) {
        warnings.push(`${sourceModelId}: excluded because upstream status is ${status}`);
        continue;
      }

      const record = normalizeModel(providerId, rule, model, rawModelId, warnings);
      if (!record) continue;
      const existingSource = runtimeSources.get(record.runtimeId.toLowerCase());
      if (existingSource && existingSource !== record.sourceId) {
        throw new Error(`duplicate runtime model id: ${record.runtimeId} from ${existingSource} and ${record.sourceId}`);
      }
      runtimeSources.set(record.runtimeId.toLowerCase(), record.sourceId);
      record.metadata = preserveLegacyRuntimeFields(record.metadata, previousModels, record.runtimeId);
      selectedRecords.push(record);
      selectedModels[record.runtimeId] = record.metadata;
    }
  }

  const allModels = {};
  const retainedIds = [];
  for (const [id, metadata] of Object.entries(previousModels)) {
    if (Object.prototype.hasOwnProperty.call(selectedModels, id)) continue;
    allModels[id] = clone(metadata);
    retainedIds.push(id);
  }
  Object.assign(allModels, selectedModels);

  const aliases = buildAliases(previousSnapshot, selectedRecords, allModels);
  const defaultModels = buildNativeDefaults(previousSnapshot, selectedRecords, allModels);
  const defaultSpeedTestModels = buildSpeedTestDefaults(previousSnapshot, defaultModels, allModels);
  const sortedModels = sortObjectByKey(allModels);
  const sortedAliases = sortObjectByKey(aliases);
  const changes = collectChanges(previousModels, selectedModels, retainedIds);
  const previousComparable = {
    defaultModels: previousSnapshot?.defaultModels || {},
    defaultSpeedTestModels: previousSnapshot?.defaultSpeedTestModels || {},
    aliases: previousSnapshot?.aliases || {},
    models: previousModels
  };
  const nextComparable = {
    defaultModels,
    defaultSpeedTestModels,
    aliases: sortedAliases,
    models: sortedModels
  };
  const contentChanged = stableStringify(previousComparable) !== stableStringify(nextComparable);
  const snapshot = {
    source: 'models.dev',
    sourceUrl: SOURCE_URL,
    lastUpdated: contentChanged
      ? updatedAt
      : (normalizeString(previousSnapshot?.lastUpdated) || updatedAt),
    defaultModels,
    defaultSpeedTestModels,
    aliases: sortedAliases,
    models: sortedModels
  };

  validateSnapshot(snapshot, {
    selectedCount: selectedRecords.length,
    previousCount: Object.keys(previousModels).length,
    minimumModelCount: Number(selectedPolicy.minimumModelCount) || 1
  });

  return { snapshot, warnings, changes };
}

async function fetchSource(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Node fetch is unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(SOURCE_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response || !response.ok) {
      throw new Error(`Models.dev request failed: HTTP ${response?.status || 'unknown'}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function writeSnapshot(snapshot, filePath = SNAPSHOT_PATH) {
  const nextText = `${JSON.stringify(snapshot, null, 2)}\n`;
  let currentText = null;
  try {
    currentText = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (currentText === nextText) return false;
  fs.writeFileSync(filePath, nextText, 'utf8');
  return true;
}

function formatList(title, values = []) {
  const lines = [`### ${title}`];
  if (!Array.isArray(values) || values.length === 0) {
    lines.push('- None');
  } else {
    values.forEach(value => lines.push(`- ${value}`));
  }
  return lines;
}

function formatReport({ snapshot, warnings = [], changes = {}, changed = false } = {}) {
  const lines = [
    '## Model catalog sync',
    '',
    `- Source: ${snapshot?.source || 'models.dev'}`,
    `- Snapshot date: ${snapshot?.lastUpdated || 'unknown'}`,
    `- Snapshot changed: ${changed ? 'yes' : 'no'}`,
    ''
  ];
  lines.push(...formatList('Added models', changes.added));
  lines.push('');
  lines.push(...formatList('Price changes', changes.priceChanged));
  lines.push('');
  lines.push(...formatList('Limit changes', changes.limitChanged));
  lines.push('');
  lines.push(...formatList('Updated models', changes.updated));
  lines.push('');
  lines.push(...formatList('Source-disappeared models retained in snapshot', changes.removed));
  lines.push('');
  lines.push(...formatList('Warnings and unsupported fields', warnings));
  lines.push('');
  lines.push('This snapshot uses Models.dev reference pricing; it is not an official real-time billing quote.');
  return `${lines.join('\n')}\n`;
}

function readPreviousSnapshot(filePath = SNAPSHOT_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isPlainObject(parsed)) throw new Error('existing model snapshot must be an object');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`failed to read existing model snapshot: ${error.message}`);
  }
}

async function main() {
  if (policy.sourceUrl !== SOURCE_URL) {
    throw new Error(`policy sourceUrl must equal ${SOURCE_URL}`);
  }
  const previousSnapshot = readPreviousSnapshot();
  const payload = await fetchSource();
  const result = buildSnapshot(payload, {
    policy,
    previousSnapshot,
    updatedAt: new Date().toISOString().slice(0, 10)
  });
  const changed = writeSnapshot(result.snapshot);
  const report = formatReport({ ...result, changed });
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(changed
    ? `Updated model catalog snapshot with ${Object.keys(result.snapshot.models).length} models.`
    : 'No model catalog changes.');
  if (result.warnings.length > 0) {
    console.warn(`Model catalog sync produced ${result.warnings.length} warnings.`);
  }
  return result;
}

module.exports = {
  SOURCE_URL,
  validateSourcePayload,
  validateSnapshot,
  buildSnapshot,
  fetchSource,
  writeSnapshot,
  formatReport,
  readPreviousSnapshot
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[model-catalog-sync] ${error.message}`);
    process.exitCode = 1;
  });
}
