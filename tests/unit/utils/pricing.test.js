import { describe, it, expect } from 'vitest';
import { resolvePricing, resolveModelPricing } from '../../../src/server/utils/pricing.js';

// Real model pricing from MODEL_METADATA (claude-sonnet-4-6):
// { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 }
const SONNET_PRICING = { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 };

describe('resolvePricing', () => {
  it('merges default pricing with model pricing', () => {
    const defaultPricing = { inputCostPer1k: 0.001, outputCostPer1k: 0.002 };
    const modelPricing = { inputCostPer1k: 0.003 };
    expect(resolvePricing('claude', modelPricing, defaultPricing))
      .toEqual({ inputCostPer1k: 0.003, outputCostPer1k: 0.002 });
  });

  it('model pricing overrides default pricing', () => {
    const defaultPricing = { inputCostPer1k: 0.001, outputCostPer1k: 0.002 };
    const modelPricing = { inputCostPer1k: 0.010, outputCostPer1k: 0.020 };
    expect(resolvePricing('claude', modelPricing, defaultPricing))
      .toEqual({ inputCostPer1k: 0.010, outputCostPer1k: 0.020 });
  });

  it('returns defaultPricing when modelPricing is null', () => {
    expect(resolvePricing('claude', null, { inputCostPer1k: 0.001 }))
      .toEqual({ inputCostPer1k: 0.001 });
  });

  it('returns defaultPricing when modelPricing is undefined', () => {
    expect(resolvePricing('claude', undefined, { inputCostPer1k: 0.001 }))
      .toEqual({ inputCostPer1k: 0.001 });
  });

  it('returns empty object when both are null/undefined', () => {
    expect(resolvePricing('claude', null, null)).toEqual({});
  });

  it('adds new keys from modelPricing not in defaultPricing', () => {
    expect(resolvePricing('claude', { outputCostPer1k: 0.005 }, { inputCostPer1k: 0.001 }))
      .toEqual({ inputCostPer1k: 0.001, outputCostPer1k: 0.005 });
  });
});

describe('resolveModelPricing', () => {
  it('falls back to fallbackPricing when no metadata available (unknown model)', () => {
    const fallbackPricing = { inputCostPer1k: 0.005 };
    const defaultPricing = { inputCostPer1k: 0.001, outputCostPer1k: 0.002 };
    const result = resolveModelPricing('claude', 'test-unknown-model-xyz', fallbackPricing, defaultPricing);
    expect(result).toEqual({ inputCostPer1k: 0.005, outputCostPer1k: 0.002 });
  });

  it('uses metadata pricing when real model metadata is available', () => {
    // claude-sonnet-4-6 has known pricing — metadata overrides fallback/default
    const fallbackPricing = { inputCostPer1k: 0.005 };
    const defaultPricing = { inputCostPer1k: 0.001, outputCostPer1k: 0.002 };
    const result = resolveModelPricing('claude', 'claude-sonnet-4-6', fallbackPricing, defaultPricing);
    // Metadata pricing merges on top — all SONNET_PRICING keys should be present
    expect(result.input).toBe(SONNET_PRICING.input);
    expect(result.output).toBe(SONNET_PRICING.output);
    expect(result.cacheCreation).toBe(SONNET_PRICING.cacheCreation);
    expect(result.cacheRead).toBe(SONNET_PRICING.cacheRead);
  });

  it('metadata pricing overrides fallback for shared keys', () => {
    // Use a real model so metadata is present; set fallback with an 'input' key
    const fallbackPricing = { input: 999, outputCostPer1k: 0.010 };
    const defaultPricing = { input: 1, outputCostPer1k: 0.002 };
    const result = resolveModelPricing('claude', 'claude-sonnet-4-6', fallbackPricing, defaultPricing);
    // Metadata 'input: 3' wins over fallback 'input: 999'
    expect(result.input).toBe(SONNET_PRICING.input);
    // outputCostPer1k not in metadata, so fallback wins over default
    expect(result.outputCostPer1k).toBe(0.010);
  });

  it('merges all three levels: default < fallback < metadata', () => {
    // default has 'extra' key not in fallback or metadata — it should survive
    const defaultPricing = { extra: 'default-only', input: 0 };
    const fallbackPricing = { fallbackKey: 'fb' };
    const result = resolveModelPricing('claude', 'claude-sonnet-4-6', fallbackPricing, defaultPricing);
    expect(result.extra).toBe('default-only');
    expect(result.fallbackKey).toBe('fb');
    expect(result.input).toBe(SONNET_PRICING.input); // metadata wins
  });

  it('handles null model gracefully — returns merged defaults only', () => {
    const result = resolveModelPricing('claude', null, { a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('handles null fallbackPricing and defaultPricing with real model', () => {
    const result = resolveModelPricing('claude', 'claude-sonnet-4-6', null, null);
    expect(result.input).toBe(SONNET_PRICING.input);
    expect(result.output).toBe(SONNET_PRICING.output);
  });

  it('returns empty object for unknown model with no fallback or default', () => {
    const result = resolveModelPricing('claude', 'test-unknown-model-xyz', null, null);
    expect(result).toEqual({});
  });
});
