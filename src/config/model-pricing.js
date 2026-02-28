/**
 * Claude Model Pricing - Backward Compatibility Re-export
 *
 * This file re-exports Claude-specific pricing and aliases from the centralized
 * model-metadata.js config. Use model-metadata.js directly for new code.
 */

const { MODEL_METADATA, MODEL_ALIASES, METADATA_LAST_UPDATED } = require('./model-metadata');

// Build CLAUDE_MODEL_PRICING from centralized metadata (Claude models only)
const CLAUDE_MODEL_PRICING = {};
for (const [id, meta] of Object.entries(MODEL_METADATA)) {
  if (id.startsWith('claude-') && meta.pricing) {
    CLAUDE_MODEL_PRICING[id] = {
      input: meta.pricing.input,
      output: meta.pricing.output,
      cacheCreation: meta.pricing.cacheCreation,
      cacheRead: meta.pricing.cacheRead
    };
  }
}

// Build CLAUDE_MODEL_ALIASES from centralized aliases (Claude models only)
const CLAUDE_MODEL_ALIASES = {};
for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
  if (alias.startsWith('claude-')) {
    CLAUDE_MODEL_ALIASES[alias] = canonical;
  }
}

module.exports = {
  CLAUDE_MODEL_PRICING,
  CLAUDE_MODEL_ALIASES,
  PRICING_LAST_UPDATED: METADATA_LAST_UPDATED
};
