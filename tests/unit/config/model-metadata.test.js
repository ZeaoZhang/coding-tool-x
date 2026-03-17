'use strict';

const {
  MODEL_METADATA,
  MODEL_ALIASES,
  DEFAULT_MODELS,
  METADATA_LAST_UPDATED,
  resolveModelMetadata,
  resolveModelLimit,
  resolveModelPricing,
  getAllModelIds,
  getDefaultModels,
  getDefaultModelsByToolType,
} = require('../../../src/config/model-metadata');

describe('model-metadata', () => {
  // ─── Data structure sanity ───────────────────────────────────────────────
  describe('data structures', () => {
    test('MODEL_METADATA is a non-empty object', () => {
      expect(typeof MODEL_METADATA).toBe('object');
      expect(MODEL_METADATA).not.toBeNull();
      expect(Object.keys(MODEL_METADATA).length).toBeGreaterThan(0);
    });

    test('METADATA_LAST_UPDATED is a string', () => {
      expect(typeof METADATA_LAST_UPDATED).toBe('string');
      expect(METADATA_LAST_UPDATED.length).toBeGreaterThan(0);
    });
  });

  // ─── resolveModelMetadata ────────────────────────────────────────────────
  describe('resolveModelMetadata', () => {
    test('null → null', () => {
      expect(resolveModelMetadata(null)).toBeNull();
    });

    test('empty string → null', () => {
      expect(resolveModelMetadata('')).toBeNull();
    });

    test('non-string number → null', () => {
      expect(resolveModelMetadata(42)).toBeNull();
    });

    test('known model returns limit and pricing', () => {
      const result = resolveModelMetadata('claude-sonnet-4-6');
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('pricing');
      expect(result.limit).toHaveProperty('context');
      expect(result.limit).toHaveProperty('output');
      expect(result.pricing).toHaveProperty('input');
      expect(result.pricing).toHaveProperty('output');
    });

    test('case insensitive exact match', () => {
      const lower = resolveModelMetadata('claude-sonnet-4-6');
      const mixed = resolveModelMetadata('Claude-Sonnet-4-6');
      expect(mixed).toEqual(lower);
    });

    test('alias match resolves to canonical metadata', () => {
      // MODEL_ALIASES: 'claude-opus-4-5' → 'claude-opus-4-5-20251101'
      const viaAlias = resolveModelMetadata('claude-opus-4-5');
      const canonical = resolveModelMetadata('claude-opus-4-5-20251101');
      expect(viaAlias).not.toBeNull();
      expect(viaAlias).toEqual(canonical);
    });

    test('prefix match (versioned id starting with known key)', () => {
      // 'claude-sonnet-4-6-20250514' should prefix-match 'claude-sonnet-4-6'
      const result = resolveModelMetadata('claude-sonnet-4-6-20250514');
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('pricing');
    });

    test('unknown claude model returns generic fallback', () => {
      const result = resolveModelMetadata('claude-unknown-99');
      expect(result).not.toBeNull();
      expect(result.limit).toEqual({ context: 200000, output: 32000 });
      expect(result.pricing).toHaveProperty('input');
      expect(result.pricing).toHaveProperty('output');
    });

    test('completely unknown non-claude model → null', () => {
      expect(resolveModelMetadata('gpt-unknown-xyz')).toBeNull();
    });

    test('whitespace-only string → null', () => {
      expect(resolveModelMetadata('   ')).toBeNull();
    });

    test('undefined → null', () => {
      expect(resolveModelMetadata(undefined)).toBeNull();
    });
  });

  // ─── resolveModelLimit ───────────────────────────────────────────────────
  describe('resolveModelLimit', () => {
    test('known model returns context and output limits', () => {
      const limit = resolveModelLimit('claude-opus-4-6');
      expect(limit).not.toBeNull();
      expect(typeof limit.context).toBe('number');
      expect(typeof limit.output).toBe('number');
    });

    test('unknown model → null', () => {
      expect(resolveModelLimit('gpt-totally-unknown')).toBeNull();
    });

    test('null → null', () => {
      expect(resolveModelLimit(null)).toBeNull();
    });
  });

  // ─── resolveModelPricing ─────────────────────────────────────────────────
  describe('resolveModelPricing', () => {
    test('known model returns input and output pricing', () => {
      const pricing = resolveModelPricing('claude-sonnet-4-6');
      expect(pricing).not.toBeNull();
      expect(typeof pricing.input).toBe('number');
      expect(typeof pricing.output).toBe('number');
    });

    test('unknown model → null', () => {
      expect(resolveModelPricing('some-unknown-model')).toBeNull();
    });

    test('null → null', () => {
      expect(resolveModelPricing(null)).toBeNull();
    });
  });

  // ─── getAllModelIds ───────────────────────────────────────────────────────
  describe('getAllModelIds', () => {
    test('returns an array', () => {
      const ids = getAllModelIds();
      expect(Array.isArray(ids)).toBe(true);
    });

    test('includes known model IDs', () => {
      const ids = getAllModelIds();
      expect(ids).toContain('claude-sonnet-4-6');
      expect(ids).toContain('claude-opus-4-6');
    });
  });

  // ─── getDefaultModels ────────────────────────────────────────────────────
  describe('getDefaultModels', () => {
    test('returns object with claude, codex, gemini arrays', () => {
      const defaults = getDefaultModels();
      expect(Array.isArray(defaults.claude)).toBe(true);
      expect(Array.isArray(defaults.codex)).toBe(true);
      expect(Array.isArray(defaults.gemini)).toBe(true);
    });

    test('arrays are non-empty', () => {
      const defaults = getDefaultModels();
      expect(defaults.claude.length).toBeGreaterThan(0);
      expect(defaults.codex.length).toBeGreaterThan(0);
      expect(defaults.gemini.length).toBeGreaterThan(0);
    });
  });

  // ─── getDefaultModelsByToolType ──────────────────────────────────────────
  describe('getDefaultModelsByToolType', () => {
    test('"claude" returns claude models array', () => {
      const models = getDefaultModelsByToolType('claude');
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    test('"codex" returns codex models array', () => {
      const models = getDefaultModelsByToolType('codex');
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    test('"gemini" returns gemini models array', () => {
      const models = getDefaultModelsByToolType('gemini');
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    test('"openai_compatible" returns codex models', () => {
      const codex = getDefaultModelsByToolType('codex');
      const compat = getDefaultModelsByToolType('openai_compatible');
      expect(compat).toEqual(codex);
    });

    test('unknown tool type → empty array', () => {
      expect(getDefaultModelsByToolType('unknown-tool')).toEqual([]);
    });
  });
});
