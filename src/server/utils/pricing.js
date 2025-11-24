const { loadConfig } = require('../../config/loader');
const DEFAULT_CONFIG = require('../../config/default');

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

module.exports = {
  resolvePricing
};
