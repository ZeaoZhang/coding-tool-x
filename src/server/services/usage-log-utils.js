'use strict';

const DEFAULT_CONFIG = require('../../config/default');
const { resolveModelPricing, calculateTokenCost } = require('../utils/pricing');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeToolSource(source = '') {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'claude-code') return 'claude';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini') return 'gemini';
  if (normalized === 'opencode') return 'opencode';
  if (normalized === 'omp' || normalized === 'omp-agent') return 'omp';
  return 'claude';
}

function normalizeModelName(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveActualModel(model = '', metadata = {}) {
  const candidates = [model, metadata.redirectedModel, metadata.modelFromUrl, metadata.requestModel, metadata.model, metadata.originalModel];
  for (const candidate of candidates) {
    const normalized = normalizeModelName(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeUsageTokens(source, tokens = {}) {
  const normalizedSource = normalizeToolSource(source);
  const input = toNumber(tokens.input);
  const output = toNumber(tokens.output);
  const cacheCreation = toNumber(tokens.cacheCreation);
  const cacheRead = toNumber(tokens.cacheRead);
  const cached = toNumber(tokens.cached);
  const reasoning = toNumber(tokens.reasoning);
  let total = toNumber(tokens.total);
  if (total <= 0) total = normalizedSource === 'claude' ? input + output + cacheCreation + cacheRead : input + output;
  return { input, output, cacheCreation, cacheRead, cached, reasoning, total };
}

function hasMeaningfulUsage(source, tokens = {}) {
  const normalized = normalizeUsageTokens(source, tokens);
  return normalized.total > 0 || normalized.input > 0 || normalized.output > 0
    || normalized.cacheCreation > 0 || normalized.cacheRead > 0
    || normalized.cached > 0 || normalized.reasoning > 0;
}

function calculateUsageCost(source, model, tokens = {}) {
  const normalizedSource = normalizeToolSource(source);
  const defaultPricing = DEFAULT_CONFIG.pricing?.[normalizedSource]
    || DEFAULT_CONFIG.pricing?.codex
    || {};
  const pricing = resolveModelPricing(normalizedSource, model, {}, defaultPricing);
  return calculateTokenCost(pricing, normalizeUsageTokens(normalizedSource, tokens), defaultPricing);
}

function formatRealtimeTime(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildSuccessLogPayload({ source, requestId, channel, model, originalModel, redirectedModel, tokens, cost = 0, timestamp = Date.now(), usageMissing = false }) {
  const normalized = normalizeUsageTokens(source, tokens);
  const payload = {
    type: 'log', status: 'success', id: requestId, time: formatRealtimeTime(timestamp), channel,
    model: model || '', inputTokens: normalized.input, outputTokens: normalized.output,
    cacheCreation: normalized.cacheCreation, cacheRead: normalized.cacheRead, cachedTokens: normalized.cached,
    reasoningTokens: normalized.reasoning, totalTokens: normalized.total, cost,
    source: normalizeToolSource(source), timestamp, usageMissing: Boolean(usageMissing)
  };
  if (originalModel) payload.originalModel = originalModel;
  if (redirectedModel) payload.redirectedModel = redirectedModel;
  return payload;
}

module.exports = {
  toNumber,
  normalizeToolSource,
  resolveActualModel,
  normalizeUsageTokens,
  hasMeaningfulUsage,
  calculateUsageCost,
  formatRealtimeTime,
  buildSuccessLogPayload
};
