'use strict';

const { normalizeModelSpec } = require('../server/services/model-definition-schema');

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

module.exports = {
  SUPPORTED_INPUT_TYPES,
  normalizeChannelModelDefinitions,
  resolveChannelModelDefinition
};
