// globals: true in vitest.config.js

const {
  detectModelTier,
  redirectModel,
  resolveTargetUrl,
  normalizeGatewaySourceType,
  normalizeNumber,
  ensureOpenAiStreamUsage,
  logModelRedirect,
} = require('../../../src/server/services/base/proxy-utils');

describe('proxy-utils', () => {
  describe('detectModelTier', () => {
    it('should detect opus tier', () => {
      expect(detectModelTier('claude-opus-4-6')).toBe('opus');
      expect(detectModelTier('claude-3-opus-20240229')).toBe('opus');
    });

    it('should detect sonnet tier', () => {
      expect(detectModelTier('claude-sonnet-4-6')).toBe('sonnet');
      expect(detectModelTier('claude-3-5-sonnet-20241022')).toBe('sonnet');
    });

    it('should detect haiku tier', () => {
      expect(detectModelTier('claude-haiku-4-5')).toBe('haiku');
    });

    it('should return null for non-Claude models', () => {
      expect(detectModelTier('gpt-4o')).toBeNull();
      expect(detectModelTier('gemini-2.5-pro')).toBeNull();
    });

    it('should return null for empty/null input', () => {
      expect(detectModelTier(null)).toBeNull();
      expect(detectModelTier(undefined)).toBeNull();
      expect(detectModelTier('')).toBeNull();
    });

    it('should be case-insensitive', () => {
      expect(detectModelTier('Claude-OPUS-4')).toBe('opus');
      expect(detectModelTier('SONNET')).toBe('sonnet');
    });
  });

  describe('redirectModel', () => {
    it('should return original model when no redirects configured', () => {
      expect(redirectModel('claude-3-5-sonnet', {})).toBe('claude-3-5-sonnet');
      expect(redirectModel('claude-3-5-sonnet', null)).toBe('claude-3-5-sonnet');
    });

    it('should return null/undefined as-is', () => {
      expect(redirectModel(null, {})).toBeNull();
      expect(redirectModel(undefined, {})).toBeUndefined();
      expect(redirectModel('', {})).toBe('');
    });

    it('should apply modelRedirects array (exact match)', () => {
      const channel = {
        modelRedirects: [
          { from: 'claude-3-5-sonnet-20241022', to: 'my-custom-sonnet' },
          { from: 'gpt-4o', to: 'gpt-4o-mini' },
        ],
      };
      expect(redirectModel('claude-3-5-sonnet-20241022', channel)).toBe('my-custom-sonnet');
      expect(redirectModel('gpt-4o', channel)).toBe('gpt-4o-mini');
    });

    it('should not match partial model names in modelRedirects', () => {
      const channel = {
        modelRedirects: [{ from: 'claude-3-5-sonnet', to: 'redirected' }],
      };
      expect(redirectModel('claude-3-5-sonnet-20241022', channel)).not.toBe('redirected');
    });

    it('should fall back to modelConfig tier matching', () => {
      const channel = {
        modelConfig: {
          opusModel: 'custom-opus',
          sonnetModel: 'custom-sonnet',
          haikuModel: 'custom-haiku',
        },
      };
      expect(redirectModel('claude-3-opus-20240229', channel)).toBe('custom-opus');
      expect(redirectModel('claude-3-5-sonnet-20241022', channel)).toBe('custom-sonnet');
      expect(redirectModel('claude-3-haiku-20240307', channel)).toBe('custom-haiku');
    });

    it('should fall back to modelConfig.model as generic override', () => {
      const channel = {
        modelConfig: { model: 'generic-model' },
      };
      expect(redirectModel('gpt-4o', channel)).toBe('generic-model');
    });

    it('should prioritize modelRedirects over modelConfig', () => {
      const channel = {
        modelRedirects: [{ from: 'claude-3-5-sonnet', to: 'redirect-wins' }],
        modelConfig: { sonnetModel: 'tier-loses' },
      };
      expect(redirectModel('claude-3-5-sonnet', channel)).toBe('redirect-wins');
    });

    it('should skip tier fallback when useTierFallback=false (Gemini mode)', () => {
      const channel = {
        modelConfig: { sonnetModel: 'should-not-match' },
      };
      expect(redirectModel('claude-3-5-sonnet', channel, { useTierFallback: false }))
        .toBe('claude-3-5-sonnet');
    });

    it('should still apply modelRedirects when useTierFallback=false', () => {
      const channel = {
        modelRedirects: [{ from: 'gemini-2.5-pro', to: 'gemini-2.5-flash' }],
        modelConfig: { model: 'should-not-match' },
      };
      expect(redirectModel('gemini-2.5-pro', channel, { useTierFallback: false }))
        .toBe('gemini-2.5-flash');
    });
  });

  describe('resolveTargetUrl', () => {
    it('should return baseUrl as-is when no conflict', () => {
      expect(resolveTargetUrl('https://api.example.com', '/v1/messages'))
        .toBe('https://api.example.com');
    });

    it('should strip trailing slash', () => {
      expect(resolveTargetUrl('https://api.example.com/', '/v1/messages'))
        .toBe('https://api.example.com');
    });

    it('should deduplicate /v1 when both baseUrl and path have it', () => {
      expect(resolveTargetUrl('https://api.example.com/v1', '/v1/responses'))
        .toBe('https://api.example.com');
    });

    it('should not strip /v1 when path does not start with /v1', () => {
      expect(resolveTargetUrl('https://api.example.com/v1', '/chat/completions'))
        .toBe('https://api.example.com/v1');
    });

    it('should handle nested paths with /v1', () => {
      expect(resolveTargetUrl('https://example.com/openai/v1', '/v1/responses'))
        .toBe('https://example.com/openai');
    });

    it('should handle empty inputs', () => {
      expect(resolveTargetUrl('', '')).toBe('');
      expect(resolveTargetUrl(undefined, undefined)).toBe('');
    });
  });

  describe('normalizeGatewaySourceType', () => {
    it('should normalize known types', () => {
      expect(normalizeGatewaySourceType('claude')).toBe('claude');
      expect(normalizeGatewaySourceType('codex')).toBe('codex');
      expect(normalizeGatewaySourceType('gemini')).toBe('gemini');
      expect(normalizeGatewaySourceType('openai_compatible')).toBe('openai_compatible');
    });

    it('should use fallback for unknown types', () => {
      expect(normalizeGatewaySourceType('unknown', 'codex')).toBe('codex');
      expect(normalizeGatewaySourceType('', 'gemini')).toBe('gemini');
    });

    it('should default fallback to claude', () => {
      expect(normalizeGatewaySourceType('')).toBe('claude');
      expect(normalizeGatewaySourceType(null)).toBe('claude');
    });

    it('should be case-insensitive', () => {
      expect(normalizeGatewaySourceType('CLAUDE')).toBe('claude');
      expect(normalizeGatewaySourceType('Codex')).toBe('codex');
    });
  });

  describe('normalizeNumber', () => {
    it('should return valid positive numbers', () => {
      expect(normalizeNumber(5, 1)).toBe(5);
      expect(normalizeNumber('10', 1)).toBe(10);
    });

    it('should return default for invalid values', () => {
      expect(normalizeNumber(null, 1)).toBe(1);
      expect(normalizeNumber(undefined, 1)).toBe(1);
      expect(normalizeNumber('abc', 1)).toBe(1);
      expect(normalizeNumber(0, 1)).toBe(1);
      expect(normalizeNumber(-5, 1)).toBe(1);
    });

    it('should clamp to max when provided', () => {
      expect(normalizeNumber(200, 1, 100)).toBe(100);
      expect(normalizeNumber(50, 1, 100)).toBe(50);
    });

    it('should not clamp when max is null', () => {
      expect(normalizeNumber(999, 1, null)).toBe(999);
    });
  });

  describe('ensureOpenAiStreamUsage', () => {
    it('should inject include_usage for streaming chat completion payloads', () => {
      const body = {
        stream: true,
        model: 'gpt-4o-mini'
      };

      expect(ensureOpenAiStreamUsage(body)).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('should preserve existing stream_options fields', () => {
      const body = {
        stream: true,
        stream_options: {
          foo: 'bar'
        }
      };

      expect(ensureOpenAiStreamUsage(body)).toBe(true);
      expect(body.stream_options).toEqual({
        foo: 'bar',
        include_usage: true
      });
    });

    it('should not mutate non-stream payloads', () => {
      const body = {
        stream: false
      };

      expect(ensureOpenAiStreamUsage(body)).toBe(false);
      expect(body.stream_options).toBeUndefined();
    });
  });

  describe('logModelRedirect', () => {
    it('should not log when models are the same', () => {
      const cache = new Map();
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logModelRedirect(cache, 'ch1', 'model-a', 'model-a', 'Channel 1', 'claude');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should log on first redirect', () => {
      const cache = new Map();
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logModelRedirect(cache, 'ch1', 'model-a', 'model-b', 'Channel 1', 'claude');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('model-a');
      expect(spy.mock.calls[0][0]).toContain('model-b');
      spy.mockRestore();
    });

    it('should not log duplicate redirects', () => {
      const cache = new Map();
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logModelRedirect(cache, 'ch1', 'model-a', 'model-b', 'Channel 1', 'claude');
      logModelRedirect(cache, 'ch1', 'model-a', 'model-b', 'Channel 1', 'claude');
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should log when redirect target changes', () => {
      const cache = new Map();
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logModelRedirect(cache, 'ch1', 'model-a', 'model-b', 'Channel 1', 'claude');
      logModelRedirect(cache, 'ch1', 'model-a', 'model-c', 'Channel 1', 'claude');
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });
  });
});
