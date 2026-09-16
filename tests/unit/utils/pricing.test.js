import { describe, it, expect } from 'vitest';
import { resolveModelPricing, calculateTokenCost } from '../../../src/server/utils/pricing.js';

// Real model pricing from MODEL_METADATA (claude-sonnet-4-6):
// { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 }
const SONNET_PRICING = { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 };

describe('resolveModelPricing', () => {
  it('uses metadata pricing when real model metadata is available', () => {
    const result = resolveModelPricing('claude', 'claude-sonnet-4-6');
    expect(result.input).toBe(SONNET_PRICING.input);
    expect(result.output).toBe(SONNET_PRICING.output);
    expect(result.cacheCreation).toBe(SONNET_PRICING.cacheCreation);
    expect(result.cacheRead).toBe(SONNET_PRICING.cacheRead);
  });

  it('returns no pricing for an unknown model without an override', () => {
    expect(resolveModelPricing('claude', 'test-unknown-model-xyz')).toEqual({});
  });

  it('handles an empty model ID without pricing', () => {
    const result = resolveModelPricing('claude', null);
    expect(result).toEqual({});
  });

  it('uses refreshed metadata pricing for new GPT and Gemini models', () => {
    expect(resolveModelPricing('codex', 'gpt-5.5')).toEqual({
      input: 5,
      output: 30,
      cacheRead: 0.5
    });
    expect(resolveModelPricing('gemini', 'gemini-3.1-pro-preview')).toEqual({
      input: 2,
      output: 12,
      cacheRead: 0.2
    });
  });

  it('keeps the metadata shape intact', () => {
    const result = resolveModelPricing('claude', 'claude-sonnet-4-6');
    expect(result.input).toBe(SONNET_PRICING.input);
    expect(result.output).toBe(SONNET_PRICING.output);
  });
});

describe('calculateTokenCost', () => {
  it('includes cached input tokens via cacheRead pricing', () => {
    const cost = calculateTokenCost(
      { input: 5, output: 30, cacheRead: 0.5 },
      { input: 1000000, output: 1000000, cacheRead: 1000000 }
    );
    expect(cost).toBeCloseTo(35.5, 8);
  });

  it('uses OpenAI-compatible cached alias when cacheRead is not present', () => {
    const cost = calculateTokenCost(
      { input: 2, output: 12, cacheRead: 0.2 },
      { input: 500000, output: 250000, cached: 100000 }
    );
    expect(cost).toBeCloseTo(4.02, 8);
  });

  it('keeps Claude cache creation pricing supported for shared callers', () => {
    const cost = calculateTokenCost(
      { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
      { input: 1000000, output: 1000000, cacheCreation: 1000000, cacheRead: 1000000 }
    );
    expect(cost).toBeCloseTo(22.05, 8);
  });

  it('can bill provider thinking tokens as output without changing the default contract', () => {
    const cost = calculateTokenCost(
      { input: 1, output: 10 },
      { input: 1000000, output: 1000000, reasoning: 200000 },
      { reasoningBilledAsOutput: true }
    );
    expect(cost).toBeCloseTo(13, 8);
  });
});
