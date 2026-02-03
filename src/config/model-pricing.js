/**
 * Centralized Claude Model Pricing
 *
 * Official Anthropic pricing as of 2026-02-02
 * Source: https://claude.com/pricing
 *
 * All prices in USD per million tokens
 */

const CLAUDE_MODEL_PRICING = {
  // Claude 4.5 (current generation)
  'claude-opus-4-5-20250929': {
    input: 5,
    output: 25,
    cacheCreation: 6.25,
    cacheRead: 0.50
  },
  'claude-sonnet-4-5-20250929': {
    input: 3,
    output: 15,
    cacheCreation: 3.75,
    cacheRead: 0.30
  },
  'claude-haiku-4-5-20250929': {
    input: 1,
    output: 5,
    cacheCreation: 1.25,
    cacheRead: 0.10
  },

  // Claude 4 (previous generation)
  'claude-opus-4-20250514': {
    input: 5,
    output: 25,
    cacheCreation: 6.25,
    cacheRead: 0.50
  },
  'claude-sonnet-4-20250514': {
    input: 3,
    output: 15,
    cacheCreation: 3.75,
    cacheRead: 0.30
  },

  // Claude 3.5
  'claude-haiku-3-5-20241022': {
    input: 1,
    output: 5,
    cacheCreation: 1.25,
    cacheRead: 0.10
  },
  'claude-3-5-haiku-20241022': {
    input: 1,
    output: 5,
    cacheCreation: 1.25,
    cacheRead: 0.10
  },
  'claude-sonnet-3-5-20241022': {
    input: 3,
    output: 15,
    cacheCreation: 3.75,
    cacheRead: 0.30
  },
  'claude-sonnet-3-5-20240620': {
    input: 3,
    output: 15,
    cacheCreation: 3.75,
    cacheRead: 0.30
  },

  // Claude 3 (legacy)
  'claude-opus-3-20240229': {
    input: 15,
    output: 75,
    cacheCreation: 18.75,
    cacheRead: 1.50
  },
  'claude-3-opus-20240229': {
    input: 15,
    output: 75,
    cacheCreation: 18.75,
    cacheRead: 1.50
  }
};

/**
 * Model name aliases for normalization
 * Maps short names to full model identifiers
 */
const CLAUDE_MODEL_ALIASES = {
  'claude-opus-4-5': 'claude-opus-4-5-20250929',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5': 'claude-haiku-4-5-20250929',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-haiku-3-5': 'claude-haiku-3-5-20241022',
  'claude-sonnet-3-5': 'claude-sonnet-3-5-20241022',
  'claude-opus-3': 'claude-opus-3-20240229'
};

module.exports = {
  CLAUDE_MODEL_PRICING,
  CLAUDE_MODEL_ALIASES,
  PRICING_LAST_UPDATED: '2026-02-02'
};
