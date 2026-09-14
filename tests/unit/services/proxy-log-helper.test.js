// globals: true in vitest.config.js

const {
  toNumber,
  normalizeToolSource,
  resolveActualModel,
  normalizeUsageTokens,
  hasMeaningfulUsage,
  buildSuccessLogPayload
} = require('../../../src/server/services/usage-log-utils');

describe('usage-log-utils', () => {
  describe('toNumber', () => {
    it('should convert valid numbers', () => {
      expect(toNumber(42)).toBe(42);
      expect(toNumber('100')).toBe(100);
      expect(toNumber(0)).toBe(0);
    });

    it('should return 0 for non-numeric values', () => {
      expect(toNumber(null)).toBe(0);
      expect(toNumber(undefined)).toBe(0);
      expect(toNumber('abc')).toBe(0);
      expect(toNumber(NaN)).toBe(0);
      expect(toNumber(Infinity)).toBe(0);
    });
  });

  describe('normalizeToolSource', () => {
    it('should normalize known sources', () => {
      expect(normalizeToolSource('claude')).toBe('claude');
      expect(normalizeToolSource('codex')).toBe('codex');
      expect(normalizeToolSource('gemini')).toBe('gemini');
      expect(normalizeToolSource('opencode')).toBe('opencode');
      expect(normalizeToolSource('omp')).toBe('omp');
      expect(normalizeToolSource('omp-agent')).toBe('omp');
    });

    it('should normalize claude-code to claude', () => {
      expect(normalizeToolSource('claude-code')).toBe('claude');
    });

    it('should default to claude for unknown sources', () => {
      expect(normalizeToolSource('')).toBe('claude');
      expect(normalizeToolSource(null)).toBe('claude');
      expect(normalizeToolSource(undefined)).toBe('claude');
      expect(normalizeToolSource('unknown')).toBe('claude');
    });

    it('should be case-insensitive', () => {
      expect(normalizeToolSource('CLAUDE')).toBe('claude');
      expect(normalizeToolSource('Codex')).toBe('codex');
      expect(normalizeToolSource('GEMINI')).toBe('gemini');
      expect(normalizeToolSource('OMP')).toBe('omp');
    });
  });

  describe('normalizeUsageTokens', () => {
    it('should normalize basic token counts', () => {
      const result = normalizeUsageTokens('claude', { input: 100, output: 50 });
      expect(result.input).toBe(100);
      expect(result.output).toBe(50);
    });

    it('should calculate total for claude with cache tokens', () => {
      const result = normalizeUsageTokens('claude', {
        input: 100,
        output: 50,
        cacheCreation: 20,
        cacheRead: 10,
      });
      expect(result.total).toBe(180); // 100 + 50 + 20 + 10
    });

    it('should calculate total for codex without cache tokens', () => {
      const result = normalizeUsageTokens('codex', {
        input: 100,
        output: 50,
      });
      expect(result.total).toBe(150); // 100 + 50
    });

    it('should use provided total if positive', () => {
      const result = normalizeUsageTokens('claude', {
        input: 100,
        output: 50,
        total: 999,
      });
      expect(result.total).toBe(999);
    });

    it('should handle empty/undefined tokens', () => {
      const result = normalizeUsageTokens('claude', {});
      expect(result.input).toBe(0);
      expect(result.output).toBe(0);
      expect(result.cacheCreation).toBe(0);
      expect(result.cacheRead).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should handle no tokens argument', () => {
      const result = normalizeUsageTokens('claude');
      expect(result.input).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('resolveActualModel', () => {
    it('should prefer parsed model when available', () => {
      expect(resolveActualModel('gpt-4o-mini', {
        redirectedModel: 'o4-mini',
        originalModel: 'gpt-4o'
      })).toBe('gpt-4o-mini');
    });

    it('should fall back to redirected model when parsed model is empty', () => {
      expect(resolveActualModel('', {
        redirectedModel: 'o4-mini',
        originalModel: 'gpt-4o'
      })).toBe('o4-mini');
    });

    it('should fall back to request/url model when redirect is absent', () => {
      expect(resolveActualModel('', {
        modelFromUrl: 'gemini-2.5-flash'
      })).toBe('gemini-2.5-flash');
    });
  });

  describe('hasMeaningfulUsage', () => {
    it('should return true when total > 0', () => {
      expect(hasMeaningfulUsage('claude', { input: 10, output: 5 })).toBe(true);
    });

    it('should return true when only cache tokens exist', () => {
      expect(hasMeaningfulUsage('claude', { cacheCreation: 10 })).toBe(true);
      expect(hasMeaningfulUsage('claude', { cacheRead: 10 })).toBe(true);
    });

    it('should return true when only reasoning tokens exist', () => {
      expect(hasMeaningfulUsage('codex', { reasoning: 10 })).toBe(true);
    });

    it('should return false for zero/empty tokens', () => {
      expect(hasMeaningfulUsage('claude', {})).toBe(false);
      expect(hasMeaningfulUsage('claude', { input: 0, output: 0 })).toBe(false);
    });
  });

  describe('buildSuccessLogPayload', () => {
    it('should build correct payload structure', () => {
      const payload = buildSuccessLogPayload({
        source: 'claude',
        requestId: 'req-1',
        channel: 'test-channel',
        model: 'claude-3-5-sonnet',
        tokens: { input: 100, output: 50 },
        cost: 0.005,
        timestamp: 1700000000000,
      });

      expect(payload.type).toBe('log');
      expect(payload.status).toBe('success');
      expect(payload.id).toBe('req-1');
      expect(payload.channel).toBe('test-channel');
      expect(payload.model).toBe('claude-3-5-sonnet');
      expect(payload.inputTokens).toBe(100);
      expect(payload.outputTokens).toBe(50);
      expect(payload.cost).toBe(0.005);
      expect(payload.source).toBe('claude');
    });

    it('should normalize tokens in payload', () => {
      const payload = buildSuccessLogPayload({
        source: 'claude',
        tokens: { input: 100, output: 50, cacheCreation: 20 },
      });

      expect(payload.cacheCreation).toBe(20);
      expect(payload.totalTokens).toBe(170);
    });
  });

});
