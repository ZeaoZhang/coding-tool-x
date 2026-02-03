const { loadConfig } = require('../../config/loader');
const DEFAULT_CONFIG = require('../../config/default');
const { CLAUDE_MODEL_PRICING, CLAUDE_MODEL_ALIASES } = require('../../config/model-pricing');

const RATE_KEYS = ['input', 'output', 'cacheCreation', 'cacheRead', 'cached', 'reasoning'];

function getPricingConfig(toolKey) {
  try {
    const config = loadConfig();
    if (config.pricing && config.pricing[toolKey]) {
      return config.pricing[toolKey];
    }
  } catch (err) {
    console.error('[Pricing] Failed to load pricing config:', err);
  }
  return DEFAULT_CONFIG.pricing[toolKey];
}

function resolvePricing(toolKey, modelPricing = {}, defaultPricing = {}) {
  const base = { ...defaultPricing, ...(modelPricing || {}) };
  const pricingConfig = getPricingConfig(toolKey);

  if (!pricingConfig) {
    return base;
  }

  if (pricingConfig.mode === 'custom') {
    const result = { ...base };
    RATE_KEYS.forEach((key) => {
      if (typeof pricingConfig[key] === 'number' && Number.isFinite(pricingConfig[key])) {
        result[key] = pricingConfig[key];
      }
    });
    return result;
  }

  return base;
}

function resolveModelPricing(toolKey, model, hardcodedPricing = {}, defaultPricing = {}) {
  const config = getPricingConfig(toolKey);

  // 1. Check user custom config for specific model first
  const modelConfig = config?.models?.[model];
  if (modelConfig && modelConfig.mode === 'custom') {
    const result = { ...hardcodedPricing };
    RATE_KEYS.forEach((key) => {
      if (typeof modelConfig[key] === 'number' && Number.isFinite(modelConfig[key])) {
        result[key] = modelConfig[key];
      }
    });
    return result;
  }

  // 2. Check user custom config for tool-level
  if (config && config.mode === 'custom') {
    const result = { ...hardcodedPricing };
    RATE_KEYS.forEach((key) => {
      if (typeof config[key] === 'number' && Number.isFinite(config[key])) {
        result[key] = config[key];
      }
    });
    return result;
  }

  // 3. Use centralized hardcoded pricing for known models (mode: 'auto')
  // Normalize model name using aliases
  const normalizedModel = CLAUDE_MODEL_ALIASES[model] || model;
  const centralizedPricing = CLAUDE_MODEL_PRICING[normalizedModel];

  if (centralizedPricing) {
    return { ...defaultPricing, ...centralizedPricing };
  }

  // 4. Fall back to base pricing for unknown models
  return { ...defaultPricing, ...hardcodedPricing };
}

module.exports = {
  resolvePricing,
  resolveModelPricing
};
