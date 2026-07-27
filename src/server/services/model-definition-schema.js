'use strict';

const MODEL_SCHEMA_VERSION = 2;
const MODEL_METADATA_MODES = ['auto', 'hybrid', 'manual'];
const THINKING_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const THINKING_SELECTOR_LEVELS = [...THINKING_EFFORT_LEVELS, 'off'];
const THINKING_MODES = [
  'effort',
  'budget',
  'google-level',
  'anthropic-adaptive',
  'anthropic-budget-effort'
];
const MODEL_APIS = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-gemini-cli',
  'google-vertex'
];

const MODEL_FIELDS = {
  id: { type: 'string', required: true, group: 'identity' },
  name: { type: 'string', group: 'identity' },
  api: { type: 'enum', values: MODEL_APIS, group: 'identity' },
  baseUrl: { type: 'string', group: 'identity' },
  reasoning: { type: 'boolean', group: 'capabilities' },
  thinking: { type: 'thinking', group: 'capabilities' },
  input: { type: 'enum-array', values: ['text', 'image'], group: 'capabilities' },
  supportsTools: { type: 'boolean', group: 'capabilities' },
  cost: { type: 'cost', group: 'limits' },
  premiumMultiplier: { type: 'non-negative-number', group: 'limits' },
  contextWindow: { type: 'positive-number', group: 'limits' },
  maxTokens: { type: 'positive-number', group: 'limits' },
  omitMaxOutputTokens: { type: 'boolean', group: 'limits' },
  headers: { type: 'string-map', sensitive: true, group: 'request' },
  compat: { type: 'compat', group: 'request' },
  contextPromotionTarget: { type: 'string', group: 'compaction' },
  compactionModel: { type: 'string', group: 'compaction' },
  remoteCompaction: { type: 'remote-compaction', group: 'compaction' }
};

const COMPAT_FIELDS = {
  supportsStore: 'boolean',
  supportsDeveloperRole: 'boolean',
  supportsMultipleSystemMessages: 'boolean',
  supportsReasoningEffort: 'boolean',
  reasoningEffortMap: 'object',
  maxTokensField: ['max_completion_tokens', 'max_tokens'],
  supportsUsageInStreaming: 'boolean',
  requiresToolResultName: 'boolean',
  requiresMistralToolIds: 'boolean',
  requiresAssistantAfterToolResult: 'boolean',
  requiresThinkingAsText: 'boolean',
  reasoningContentField: ['reasoning_content', 'reasoning', 'reasoning_text'],
  requiresReasoningContentForToolCalls: 'boolean',
  allowsSyntheticReasoningContentForToolCalls: 'boolean',
  requiresAssistantContentForToolCalls: 'boolean',
  supportsToolChoice: 'boolean',
  supportsForcedToolChoice: 'boolean',
  disableReasoningOnForcedToolChoice: 'boolean',
  disableReasoningOnToolChoice: 'boolean',
  thinkingFormat: ['openai', 'openrouter', 'zai', 'qwen', 'qwen-chat-template'],
  openRouterRouting: 'object',
  vercelGatewayRouting: 'object',
  extraBody: 'object',
  cacheControlFormat: ['anthropic'],
  supportsStrictMode: 'boolean',
  toolStrictMode: ['all_strict', 'none'],
  streamIdleTimeoutMs: 'positive-number',
  supportsLongPromptCacheRetention: 'boolean',
  supportsReasoningParams: 'boolean',
  alwaysSendMaxTokens: 'boolean',
  strictResponsesPairing: 'boolean',
  supportsImageDetailOriginal: 'boolean',
  requiresToolResultId: 'boolean',
  replayUnsignedThinking: 'boolean',
  nested: 'object'
};

const REMOTE_COMPACTION_FIELDS = {
  enabled: 'boolean',
  api: 'string',
  endpoint: 'string',
  model: 'string',
  v2StreamingEnabled: 'boolean',
  v2Endpoint: 'string',
  streamingEndpoint: 'string'
};

const PROVIDER_FIELDS = {
  baseUrl: { type: 'string' },
  apiKey: { type: 'string', sensitive: true },
  api: { type: 'enum', values: MODEL_APIS },
  headers: { type: 'string-map', sensitive: true },
  compat: { type: 'compat' },
  remoteCompaction: { type: 'remote-compaction' },
  authHeader: { type: 'boolean' },
  auth: { type: 'enum', values: ['apiKey', 'none', 'oauth'] },
  discovery: {
    type: 'enum',
    values: ['ollama', 'llama.cpp', 'lm-studio', 'openai-models-list', 'proxy', 'litellm']
  },
  modelOverrides: { type: 'object' },
  disableStrictTools: { type: 'boolean' },
  transport: { type: 'enum', values: ['pi-native'] }
};

const MANAGEMENT_FIELDS = new Set([
  'schemaVersion',
  'metadataMode',
  'source',
  'overrides',
  'defaultThinkingLevel',
  'passthrough'
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function isSensitiveKey(key) {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!normalized) return false;
  if ([
    'apikey',
    'authorization',
    'token',
    'accesstoken',
    'refreshtoken',
    'authtoken',
    'bearertoken',
    'idtoken',
    'secret',
    'clientsecret',
    'password',
    'cookie',
    'setcookie'
  ].includes(normalized)) return true;
  return normalized.endsWith('apikey')
    || normalized.endsWith('token')
    || normalized.endsWith('secret')
    || normalized.endsWith('password');
}

function redactSensitiveFields(value, key = '') {
  if (Array.isArray(value)) return value.map(item => redactSensitiveFields(item));
  if (!isPlainObject(value)) {
    return isSensitiveKey(key) ? '[redacted]' : value;
  }
  if (key === 'headers') {
    return Object.fromEntries(Object.keys(value).map(header => [header, '[redacted]']));
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, item]) => [childKey, redactSensitiveFields(item, childKey)])
  );
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function splitModelSelector(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/:(minimal|low|medium|high|xhigh|off)$/i);
  if (!match) return { modelId: raw, thinkingLevel: null };
  return {
    modelId: raw.slice(0, -match[0].length),
    thinkingLevel: match[1].toLowerCase()
  };
}

function serializeModelSelector(modelId, thinkingLevel) {
  const base = splitModelSelector(modelId).modelId;
  const level = String(thinkingLevel || '').trim().toLowerCase();
  return base && THINKING_SELECTOR_LEVELS.includes(level) ? `${base}:${level}` : base;
}

function normalizeNumber(value, { positive = false, nonNegative = false } = {}) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  if (positive && number <= 0) return undefined;
  if (nonNegative && number < 0) return undefined;
  return number;
}

function normalizeStringMap(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeCost(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  const aliases = {
    input: ['input'],
    output: ['output'],
    cacheRead: ['cacheRead', 'cache_read'],
    cacheWrite: ['cacheWrite', 'cache_write', 'cacheCreation']
  };
  for (const [target, candidates] of Object.entries(aliases)) {
    const key = candidates.find(candidate => value[candidate] !== undefined);
    if (!key) continue;
    const number = normalizeNumber(value[key], { nonNegative: true });
    if (number !== undefined) result[target] = number;
  }
  if (Object.keys(result).length === 0) return undefined;
  // OMP's cost object is all-or-nothing: when present, all four numeric keys
  // are required. Zero here means “no known charge for this dimension”; an
  // entirely unknown cost remains omitted above.
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    ...result
  };
}

function normalizeThinking(value) {
  if (Array.isArray(value)) {
    const efforts = [...new Set(value.map(item => String(item || '').trim()).filter(item => THINKING_EFFORT_LEVELS.includes(item)))];
    return efforts.length > 0 ? { mode: 'effort', efforts } : undefined;
  }
  if (typeof value === 'string') {
    const level = value.trim();
    return THINKING_EFFORT_LEVELS.includes(level) ? { mode: 'effort', efforts: [level] } : undefined;
  }
  if (!isPlainObject(value)) return undefined;
  const mode = THINKING_MODES.includes(value.mode) ? value.mode : undefined;
  if (!mode) return undefined;
  const efforts = Array.isArray(value.efforts || value.levels)
    ? [...new Set((value.efforts || value.levels)
      .map(item => String(item || '').trim())
      .filter(item => THINKING_EFFORT_LEVELS.includes(item)))]
    : undefined;
  const defaultLevel = THINKING_EFFORT_LEVELS.includes(value.defaultLevel) ? value.defaultLevel : undefined;
  const minLevel = THINKING_EFFORT_LEVELS.includes(value.minLevel) ? value.minLevel : undefined;
  const maxLevel = THINKING_EFFORT_LEVELS.includes(value.maxLevel) ? value.maxLevel : undefined;
  return compactObject({
    mode,
    efforts: efforts?.length ? efforts : undefined,
    defaultLevel,
    minLevel: efforts?.length ? undefined : minLevel,
    maxLevel: efforts?.length ? undefined : maxLevel,
    levels: Array.isArray(value.levels) ? cloneValue(value.levels) : undefined,
    effortMap: isPlainObject(value.effortMap) ? cloneValue(value.effortMap) : undefined,
    supportsDisplay: typeof value.supportsDisplay === 'boolean' ? value.supportsDisplay : undefined
  });
}

function normalizeTypedObject(value, fields, warnings, prefix) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const descriptor = fields[key];
    if (!descriptor) {
      warnings.push(`${prefix}.${key} is not supported by the current coding-tool-x schema`);
      continue;
    }
    let normalized;
    if (descriptor === 'boolean') normalized = typeof item === 'boolean' ? item : undefined;
    else if (descriptor === 'string') normalized = typeof item === 'string' ? item : undefined;
    else if (descriptor === 'object') normalized = isPlainObject(item) ? cloneValue(item) : undefined;
    else if (descriptor === 'positive-number') normalized = normalizeNumber(item, { positive: true });
    else if (Array.isArray(descriptor)) normalized = descriptor.includes(item) ? item : undefined;
    if (normalized === undefined) warnings.push(`${prefix}.${key} has an invalid value`);
    else result[key] = normalized;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function extractPassthrough(value) {
  if (!isPlainObject(value)) return {};
  const result = isPlainObject(value.passthrough) ? cloneValue(value.passthrough) : {};
  for (const [key, item] of Object.entries(value)) {
    if (!MODEL_FIELDS[key] && !MANAGEMENT_FIELDS.has(key) && key !== 'limit' && key !== 'pricing') {
      result[key] = cloneValue(item);
    }
  }
  if (isPlainObject(value.compat)) {
    const unknownCompat = Object.fromEntries(
      Object.entries(value.compat).filter(([key]) => !COMPAT_FIELDS[key]).map(([key, item]) => [key, cloneValue(item)])
    );
    if (Object.keys(unknownCompat).length > 0) {
      result.compat = { ...(isPlainObject(result.compat) ? result.compat : {}), ...unknownCompat };
    }
  }
  if (isPlainObject(value.remoteCompaction)) {
    const unknownRemote = Object.fromEntries(
      Object.entries(value.remoteCompaction)
        .filter(([key]) => !REMOTE_COMPACTION_FIELDS[key])
        .map(([key, item]) => [key, cloneValue(item)])
    );
    if (Object.keys(unknownRemote).length > 0) {
      result.remoteCompaction = {
        ...(isPlainObject(result.remoteCompaction) ? result.remoteCompaction : {}),
        ...unknownRemote
      };
    }
  }
  return result;
}

function normalizeModelSpec(value = {}, fallbackId = '') {
  const warnings = [];
  const source = isPlainObject(value) ? value : {};
  for (const key of Object.keys(source)) {
    if (!MODEL_FIELDS[key] && !MANAGEMENT_FIELDS.has(key) && key !== 'limit' && key !== 'pricing') {
      warnings.push(`${key} is not supported by the current coding-tool-x schema`);
    }
  }
  const rawId = source.id || source.name || fallbackId;
  const { modelId } = splitModelSelector(rawId);
  if (!modelId) return { spec: null, passthrough: extractPassthrough(source), warnings: ['model id is required'] };

  const legacyLimit = isPlainObject(source.limit) ? source.limit : {};
  const legacyPricing = isPlainObject(source.pricing) ? source.pricing : {};
  const input = Array.isArray(source.input)
    ? [...new Set(source.input.filter(item => item === 'text' || item === 'image'))]
    : undefined;
  const api = source.api === undefined || MODEL_APIS.includes(source.api) ? source.api : undefined;
  if (source.api !== undefined && api === undefined) warnings.push('api has an invalid value');

  const spec = compactObject({
    id: modelId,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : undefined,
    api,
    baseUrl: typeof source.baseUrl === 'string' && source.baseUrl.trim() ? source.baseUrl.trim() : undefined,
    reasoning: typeof source.reasoning === 'boolean' ? source.reasoning : undefined,
    thinking: normalizeThinking(source.thinking),
    input: input?.length ? input : undefined,
    supportsTools: typeof source.supportsTools === 'boolean' ? source.supportsTools : undefined,
    cost: normalizeCost(source.cost || legacyPricing),
    premiumMultiplier: normalizeNumber(source.premiumMultiplier, { nonNegative: true }),
    contextWindow: normalizeNumber(source.contextWindow ?? source.context_window ?? legacyLimit.context, { positive: true }),
    maxTokens: normalizeNumber(source.maxTokens ?? source.max_tokens ?? legacyLimit.output, { positive: true }),
    omitMaxOutputTokens: typeof source.omitMaxOutputTokens === 'boolean' ? source.omitMaxOutputTokens : undefined,
    headers: normalizeStringMap(source.headers),
    compat: normalizeTypedObject(source.compat, COMPAT_FIELDS, warnings, 'compat'),
    contextPromotionTarget: typeof source.contextPromotionTarget === 'string' ? source.contextPromotionTarget : undefined,
    compactionModel: typeof source.compactionModel === 'string' ? source.compactionModel : undefined,
    remoteCompaction: normalizeTypedObject(source.remoteCompaction, REMOTE_COMPACTION_FIELDS, warnings, 'remoteCompaction')
  });
  const invalidWhenPresent = (key, valid) => {
    if (source[key] !== undefined && !valid) warnings.push(`${key} has an invalid value`);
  };
  invalidWhenPresent('name', typeof source.name === 'string');
  invalidWhenPresent('baseUrl', typeof source.baseUrl === 'string');
  invalidWhenPresent('reasoning', typeof source.reasoning === 'boolean');
  invalidWhenPresent('thinking', spec.thinking !== undefined);
  invalidWhenPresent('input', Array.isArray(source.input) && source.input.length > 0 && spec.input !== undefined);
  invalidWhenPresent('supportsTools', typeof source.supportsTools === 'boolean');
  invalidWhenPresent('cost', isPlainObject(source.cost) && spec.cost !== undefined);
  invalidWhenPresent('premiumMultiplier', spec.premiumMultiplier !== undefined);
  if (source.contextWindow !== undefined || source.context_window !== undefined) {
    invalidWhenPresent(source.contextWindow !== undefined ? 'contextWindow' : 'context_window', spec.contextWindow !== undefined);
  }
  if (source.maxTokens !== undefined || source.max_tokens !== undefined) {
    invalidWhenPresent(source.maxTokens !== undefined ? 'maxTokens' : 'max_tokens', spec.maxTokens !== undefined);
  }
  invalidWhenPresent('omitMaxOutputTokens', typeof source.omitMaxOutputTokens === 'boolean');
  invalidWhenPresent('headers', isPlainObject(source.headers)
    && Object.values(source.headers).every(item => typeof item === 'string'));
  invalidWhenPresent('compat', isPlainObject(source.compat));
  invalidWhenPresent('contextPromotionTarget', typeof source.contextPromotionTarget === 'string');
  invalidWhenPresent('compactionModel', typeof source.compactionModel === 'string');
  invalidWhenPresent('remoteCompaction', isPlainObject(source.remoteCompaction));
  return { spec, passthrough: extractPassthrough(source), warnings };
}

function normalizeCatalogModelList(value) {
  const selected = new Map();
  const warnings = [];
  for (const rawModel of Array.isArray(value) ? value : []) {
    const rawId = String(rawModel?.id || rawModel?.name || '').trim();
    const normalized = normalizeModelSpec(rawModel, rawId);
    if (!normalized.spec?.id) continue;
    warnings.push(...normalized.warnings.map(message => `${normalized.spec.id}: ${message}`));
    const key = normalized.spec.id.toLowerCase();
    const canonical = splitModelSelector(rawId).thinkingLevel === null;
    const score = Object.keys(normalized.spec).length;
    const previous = selected.get(key);
    if (!previous || (canonical && !previous.canonical) || (canonical === previous.canonical && score > previous.score)) {
      selected.set(key, { spec: normalized.spec, canonical, score });
    }
  }
  return {
    models: [...selected.values()].map(item => item.spec),
    warnings: [...new Set(warnings)]
  };
}

function normalizeProviderConfig(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const warnings = [];
  const passthrough = {};
  const config = {};
  for (const [key, item] of Object.entries(source)) {
    const descriptor = PROVIDER_FIELDS[key];
    if (!descriptor) {
      passthrough[key] = cloneValue(item);
      warnings.push(`${key} is not supported by the current coding-tool-x provider schema`);
      continue;
    }
    let normalized;
    if (descriptor.type === 'string') normalized = typeof item === 'string' ? item : undefined;
    else if (descriptor.type === 'boolean') normalized = typeof item === 'boolean' ? item : undefined;
    else if (descriptor.type === 'object') normalized = isPlainObject(item) ? cloneValue(item) : undefined;
    else if (descriptor.type === 'string-map') normalized = normalizeStringMap(item);
    else if (descriptor.type === 'compat') {
      normalized = isPlainObject(item) ? (normalizeTypedObject(item, COMPAT_FIELDS, warnings, 'compat') || {}) : undefined;
    }
    else if (descriptor.type === 'remote-compaction') {
      normalized = isPlainObject(item)
        ? (normalizeTypedObject(item, REMOTE_COMPACTION_FIELDS, warnings, 'remoteCompaction') || {})
        : undefined;
    } else if (descriptor.type === 'enum') {
      normalized = descriptor.values.includes(item) ? item : undefined;
    }
    if (normalized === undefined) warnings.push(`${key} has an invalid value`);
    else config[key] = normalized;
  }
  return { config, passthrough, warnings };
}

function mergeModelSpecs(...values) {
  const result = {};
  for (const value of values) {
    if (!isPlainObject(value)) continue;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (isPlainObject(item) && isPlainObject(result[key])) result[key] = { ...result[key], ...cloneValue(item) };
      else result[key] = cloneValue(item);
    }
  }
  return result;
}

function markProvenance(target, value, sourceName, prefix = '') {
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    target[path] = sourceName;
    if (isPlainObject(item)) markProvenance(target, item, sourceName, path);
  }
}

function resolveModelDefinition(definition, sources = {}) {
  const raw = typeof definition === 'string' ? { id: definition } : (definition || {});
  const direct = Object.fromEntries(Object.entries(raw).filter(([key]) => !MANAGEMENT_FIELDS.has(key)));
  const explicitRaw = isPlainObject(raw.overrides) ? { id: raw.id, ...direct, ...raw.overrides } : direct;
  const explicit = normalizeModelSpec(explicitRaw, raw.id);
  const builtin = normalizeModelSpec(sources.builtin || {}, raw.id);
  const catalog = normalizeModelSpec(sources.catalog || {}, raw.id);
  const mode = MODEL_METADATA_MODES.includes(raw.metadataMode)
    ? raw.metadataMode
    : (typeof definition === 'string' ? 'auto' : 'hybrid');
  const automaticSpec = mergeModelSpecs(builtin.spec, catalog.spec);
  const spec = mode === 'manual'
    ? explicit.spec
    : mergeModelSpecs(automaticSpec, explicit.spec);
  const provenance = {};
  if (mode !== 'manual') {
    markProvenance(provenance, builtin.spec, 'builtin');
    markProvenance(provenance, catalog.spec, 'omp-catalog');
  }
  markProvenance(provenance, explicit.spec, 'explicit');
  return {
    schemaVersion: MODEL_SCHEMA_VERSION,
    metadataMode: mode,
    spec,
    provenance,
    passthrough: {
      ...builtin.passthrough,
      ...catalog.passthrough,
      ...explicit.passthrough
    },
    warnings: [...builtin.warnings, ...catalog.warnings, ...explicit.warnings]
  };
}

function validateModelDefinitions(value) {
  if (!Array.isArray(value)) return { valid: false, error: 'models must be an array', warnings: [] };
  const warnings = [];
  const seen = new Set();
  for (const definition of value) {
    if (typeof definition !== 'string' && !isPlainObject(definition)) {
      return { valid: false, error: 'each model must be a string or object', warnings };
    }
    const resolved = resolveModelDefinition(definition);
    if (!resolved.spec?.id) return { valid: false, error: 'each model requires a non-empty id', warnings };
    const invalid = resolved.warnings.find(message => message.endsWith('has an invalid value'));
    if (invalid) return { valid: false, error: `${resolved.spec.id}: ${invalid}`, warnings };
    const key = resolved.spec.id.toLowerCase();
    if (seen.has(key)) return { valid: false, error: `duplicate model id: ${resolved.spec.id}`, warnings };
    seen.add(key);
    warnings.push(...resolved.warnings.map(message => `${resolved.spec.id}: ${message}`));
  }
  return { valid: true, error: null, warnings };
}

function validateProviderConfig(value) {
  if (!isPlainObject(value)) return { valid: false, error: 'providerConfig must be an object', warnings: [] };
  const normalized = normalizeProviderConfig(value);
  const invalid = normalized.warnings.find(message => message.endsWith('has an invalid value'));
  return {
    valid: !invalid,
    error: invalid || null,
    warnings: normalized.warnings,
    config: normalized.config,
    passthrough: normalized.passthrough
  };
}

function getPublicModelFieldSchema() {
  return cloneValue({
    schemaVersion: MODEL_SCHEMA_VERSION,
    metadataModes: MODEL_METADATA_MODES,
    thinkingEffortLevels: THINKING_EFFORT_LEVELS,
    thinkingSelectorLevels: THINKING_SELECTOR_LEVELS,
    thinkingModes: THINKING_MODES,
    modelApis: MODEL_APIS,
    modelFields: MODEL_FIELDS,
    compatFields: COMPAT_FIELDS,
    remoteCompactionFields: REMOTE_COMPACTION_FIELDS,
    providerFields: PROVIDER_FIELDS
  });
}

module.exports = {
  MODEL_SCHEMA_VERSION,
  MODEL_METADATA_MODES,
  THINKING_EFFORT_LEVELS,
  THINKING_SELECTOR_LEVELS,
  THINKING_MODES,
  MODEL_APIS,
  MODEL_FIELDS,
  COMPAT_FIELDS,
  REMOTE_COMPACTION_FIELDS,
  PROVIDER_FIELDS,
  getPublicModelFieldSchema,
  isPlainObject,
  mergeModelSpecs,
  normalizeModelSpec,
  normalizeCatalogModelList,
  normalizeProviderConfig,
  redactSensitiveFields,
  resolveModelDefinition,
  serializeModelSelector,
  splitModelSelector,
  validateModelDefinitions,
  validateProviderConfig
};
