const { CLAUDE_MODEL_PRICING, CLAUDE_MODEL_ALIASES, PRICING_LAST_UPDATED } = require('../../../src/config/model-pricing');

describe('model-pricing', () => {
  describe('CLAUDE_MODEL_PRICING', () => {
    test('is a non-empty object', () => {
      expect(typeof CLAUDE_MODEL_PRICING).toBe('object');
      expect(CLAUDE_MODEL_PRICING).not.toBeNull();
      expect(Object.keys(CLAUDE_MODEL_PRICING).length).toBeGreaterThan(0);
    });

    test('all keys start with "claude-"', () => {
      for (const key of Object.keys(CLAUDE_MODEL_PRICING)) {
        expect(key.startsWith('claude-')).toBe(true);
      }
    });

    test('each entry has numeric input and output fields', () => {
      for (const [id, entry] of Object.entries(CLAUDE_MODEL_PRICING)) {
        expect(typeof entry.input, `${id}.input`).toBe('number');
        expect(typeof entry.output, `${id}.output`).toBe('number');
      }
    });

    test('pricing values are positive numbers', () => {
      for (const [id, entry] of Object.entries(CLAUDE_MODEL_PRICING)) {
        expect(entry.input, `${id}.input`).toBeGreaterThan(0);
        expect(entry.output, `${id}.output`).toBeGreaterThan(0);
      }
    });

    test('no non-claude models are included', () => {
      for (const key of Object.keys(CLAUDE_MODEL_PRICING)) {
        expect(key).toMatch(/^claude-/);
      }
    });

    test('known model claude-sonnet-4-6 has pricing', () => {
      expect(CLAUDE_MODEL_PRICING['claude-sonnet-4-6']).toBeDefined();
      expect(typeof CLAUDE_MODEL_PRICING['claude-sonnet-4-6'].input).toBe('number');
      expect(typeof CLAUDE_MODEL_PRICING['claude-sonnet-4-6'].output).toBe('number');
    });

    test('known model claude-opus-4-7 inherits current opus 4.6 pricing', () => {
      expect(CLAUDE_MODEL_PRICING['claude-opus-4-7']).toEqual({
        input: 5,
        output: 25,
        cacheCreation: 6.25,
        cacheRead: 0.5
      });
    });
  });

  describe('CLAUDE_MODEL_ALIASES', () => {
    test('is a non-empty object', () => {
      expect(typeof CLAUDE_MODEL_ALIASES).toBe('object');
      expect(CLAUDE_MODEL_ALIASES).not.toBeNull();
      expect(Object.keys(CLAUDE_MODEL_ALIASES).length).toBeGreaterThan(0);
    });

    test('all alias keys start with "claude-"', () => {
      for (const alias of Object.keys(CLAUDE_MODEL_ALIASES)) {
        expect(alias.startsWith('claude-')).toBe(true);
      }
    });

    test('all alias values are strings (canonical model IDs)', () => {
      for (const [alias, canonical] of Object.entries(CLAUDE_MODEL_ALIASES)) {
        expect(typeof canonical, `alias ${alias}`).toBe('string');
        expect(canonical.length, `alias ${alias} value`).toBeGreaterThan(0);
      }
    });
  });

  describe('PRICING_LAST_UPDATED', () => {
    test('is a string', () => {
      expect(typeof PRICING_LAST_UPDATED).toBe('string');
      expect(PRICING_LAST_UPDATED.length).toBeGreaterThan(0);
    });
  });
});
