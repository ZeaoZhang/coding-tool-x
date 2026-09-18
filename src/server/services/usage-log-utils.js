'use strict';

const { normalizeUsage: normalizeNativeUsage } = require('../../platforms/drivers/native-log-utils');
const { resolveModelPricing, calculateTokenCost } = require('../utils/pricing');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeToolSource(source = '') {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'dsh') return 'dsh';
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
  const normalizedUsage = normalizeNativeUsage(tokens);
  const input = toNumber(normalizedUsage.input);
  const output = toNumber(normalizedUsage.output);
  const cacheCreation = toNumber(normalizedUsage.cacheCreation);
  const cacheRead = toNumber(normalizedUsage.cacheRead || normalizedUsage.cached);
  const cached = toNumber(normalizedUsage.cached || cacheRead);
  const reasoning = toNumber(normalizedUsage.reasoning);
  const hasPositiveReportedTotal = ['total', 'total_tokens', 'totalTokens', 'totalTokenCount']
    .some(key => toNumber(tokens?.[key]) > 0);
  let total = toNumber(normalizedUsage.total);
  if (!hasPositiveReportedTotal) {
    if (normalizedSource === 'claude') {
      total = input + output + cacheCreation + cacheRead;
    } else if (normalizedSource === 'gemini') {
      total = input + output + cacheCreation + cacheRead + reasoning;
    }
  }
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
  const pricing = resolveModelPricing(normalizedSource, model);
  return calculateTokenCost(pricing, normalizeUsageTokens(normalizedSource, tokens), {
    reasoningBilledAsOutput: normalizedSource === 'gemini'
  });
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
