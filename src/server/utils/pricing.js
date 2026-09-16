const { loadConfig } = require('../../config/loader');
const { resolveModelMetadata } = require('../../config/model-metadata');

function normalizeModelId(model) {
  return String(model || '').trim().toLowerCase();
}

function getModelMetadataOverride(overrides, model) {
  if (!overrides || typeof overrides !== 'object') return null;
  const modelId = normalizeModelId(model);
  if (!modelId) return null;

  let directMatch = null;
  for (const [id, override] of Object.entries(overrides)) {
    if (normalizeModelId(id) === modelId) {
      directMatch = override;
      break;
    }
  }
  if (directMatch) return directMatch;

  let bestMatch = null;
  let bestLen = 0;
  for (const [id, override] of Object.entries(overrides)) {
    const key = normalizeModelId(id);
    if (!key) continue;
    if (modelId.startsWith(key) || key.startsWith(modelId)) {
      if (key.length > bestLen) {
        bestLen = key.length;
        bestMatch = override;
      }
    }
  }
  return bestMatch;
}

function resolveMetadataPricing(model) {
  if (!model) return null;

  const builtInPricing = resolveModelMetadata(model)?.pricing || null;

  try {
    const config = loadConfig();
    const override = getModelMetadataOverride(config.modelMetadataOverrides, model);
    const overridePricing = override?.pricing || null;
    if (!builtInPricing && !overridePricing) return null;
    return {
      ...(builtInPricing || {}),
      ...(overridePricing || {})
    };
  } catch (err) {
    console.error('[Pricing] Failed to load model metadata overrides:', err);
    return builtInPricing;
  }
}

function resolveModelPricing(_toolKey, model) {
  const pricingFromMetadata = resolveMetadataPricing(model);
  return pricingFromMetadata ? { ...pricingFromMetadata } : {};
}

function getRate(pricing, key) {
  if (typeof pricing?.[key] === 'number') return pricing[key];
  return 0;
}

function calculateTokenCost(pricing = {}, tokens = {}, options = {}) {
  const inputRate = getRate(pricing, 'input');
  const outputRate = getRate(pricing, 'output');
  const cacheCreationRate = getRate(pricing, 'cacheCreation');
  const cacheReadRate = getRate(pricing, 'cacheRead');
  const inputTokens = Number(tokens.input || 0);
  const outputTokens = Number(tokens.output || 0)
    + (options.reasoningBilledAsOutput ? Number(tokens.reasoning || 0) : 0);
  const cacheCreationTokens = Number(tokens.cacheCreation || 0);
  const cacheReadTokens = Number(tokens.cacheRead || tokens.cached || 0);

  return (
    inputTokens * inputRate / 1000000 +
    outputTokens * outputRate / 1000000 +
    cacheCreationTokens * cacheCreationRate / 1000000 +
    cacheReadTokens * cacheReadRate / 1000000
  );
}

module.exports = {
  resolveModelPricing,
  calculateTokenCost
};
