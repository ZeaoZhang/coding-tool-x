// globals: true in vitest.config.js

const {
  toNumber,
  normalizeToolSource,
  resolveActualModel,
  normalizeUsageTokens,
  hasMeaningfulUsage,
  buildSuccessLogPayload,
  buildFailureLogPayload,
  publishUsageLog,
  publishFailureLog,
} = require('../../../src/server/services/proxy-log-helper');

describe('proxy-log-helper', () => {
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

  describe('buildFailureLogPayload', () => {
    it('should build correct failure payload', () => {
      const payload = buildFailureLogPayload({
        source: 'codex',
        requestId: 'req-2',
        channel: 'test-channel',
        message: 'Connection timeout',
        statusCode: 502,
        stage: 'proxy',
      });

      expect(payload.type).toBe('log');
      expect(payload.status).toBe('error');
      expect(payload.message).toBe('Connection timeout');
      expect(payload.statusCode).toBe(502);
      expect(payload.stage).toBe('proxy');
      expect(payload.source).toBe('codex');
      expect(payload.totalTokens).toBe(0);
      expect(payload.cost).toBe(0);
    });

    it('should extract message from error object', () => {
      const payload = buildFailureLogPayload({
        source: 'claude',
        error: new Error('some error'),
      });
      expect(payload.message).toBe('some error');
    });

    it('should prefer structured message over raw error text for display', () => {
      const payload = buildFailureLogPayload({
        source: 'claude',
        message: 'OpenAI gateway network error: aborted',
        error: new Error('aborted'),
        stage: 'openai_gateway_network'
      });

      expect(payload.message).toBe('OpenAI gateway network error: aborted');
      expect(payload.error).toBe('OpenAI gateway network error: aborted');
      expect(payload.rawError).toBe('aborted');
      expect(payload.stage).toBe('openai_gateway_network');
    });

    it('should generate request ID if not provided', () => {
      const payload = buildFailureLogPayload({ source: 'claude' });
      expect(payload.id).toBeTruthy();
      expect(payload.id).toContain('claude');
    });
  });

  describe('publishUsageLog', () => {
    it('should return null for zero usage', () => {
      const result = publishUsageLog({
        source: 'claude',
        tokens: { input: 0, output: 0 },
      });
      expect(result).toBeNull();
    });

    it('should call broadcastLog and recordRequest for meaningful usage', () => {
      const broadcastLog = vi.fn();
      const recordRequest = vi.fn();
      const recordSuccess = vi.fn();

      const result = publishUsageLog({
        source: 'claude',
        metadata: { id: 'req-1', channel: 'ch1', channelId: 'ch1-id' },
        model: 'claude-3-5-sonnet',
        tokens: { input: 100, output: 50 },
        calculateCost: () => 0.005,
        broadcastLog,
        recordRequest,
        recordSuccess,
      });

      expect(result).not.toBeNull();
      expect(result.cost).toBe(0.005);
      expect(broadcastLog).toHaveBeenCalledTimes(1);
      expect(recordRequest).toHaveBeenCalledTimes(1);
      expect(recordSuccess).toHaveBeenCalledTimes(1);
      expect(recordSuccess).toHaveBeenCalledWith('ch1-id', 'claude');
    });

    it('should broadcast resolved actual model even when upstream usage is missing', () => {
      const broadcastLog = vi.fn();
      const recordRequest = vi.fn();
      const recordSuccess = vi.fn();

      const result = publishUsageLog({
        source: 'codex',
        metadata: {
          id: 'req-redirected',
          channel: 'redirected-channel',
          channelId: 'redirected-channel-id',
          originalModel: 'gpt-4o',
          redirectedModel: 'gpt-4o-mini'
        },
        model: '',
        tokens: {},
        broadcastLog,
        recordRequest,
        recordSuccess,
      });

      expect(result).not.toBeNull();
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.usageMissing).toBe(true);
      expect(broadcastLog).toHaveBeenCalledTimes(1);
      expect(broadcastLog.mock.calls[0][0]).toMatchObject({
        model: 'gpt-4o-mini',
        originalModel: 'gpt-4o',
        redirectedModel: 'gpt-4o-mini',
        usageMissing: true
      });
      expect(recordRequest).not.toHaveBeenCalled();
      expect(recordSuccess).toHaveBeenCalledWith('redirected-channel-id', 'codex');
    });

    it('should preserve claude source while logging redirected GLM model and tokens', () => {
      const broadcastLog = vi.fn();
      const recordRequest = vi.fn();

      const result = publishUsageLog({
        source: 'claude',
        metadata: {
          id: 'req-glm',
          channel: '智谱 GLM',
          channelId: 'zhipu-id',
          originalModel: 'claude-3-7-sonnet',
          redirectedModel: 'glm-4.6'
        },
        model: '',
        tokens: {
          input: 1200,
          output: 300,
          cacheCreation: 200,
          cacheRead: 50,
          total: 1750
        },
        broadcastLog,
        recordRequest
      });

      expect(result).not.toBeNull();
      expect(result.model).toBe('glm-4.6');
      expect(result.tokens).toMatchObject({
        input: 1200,
        output: 300,
        cacheCreation: 200,
        cacheRead: 50,
        total: 1750
      });
      expect(broadcastLog).toHaveBeenCalledWith(expect.objectContaining({
        source: 'claude',
        channel: '智谱 GLM',
        model: 'glm-4.6',
        originalModel: 'claude-3-7-sonnet',
        redirectedModel: 'glm-4.6',
        inputTokens: 1200,
        outputTokens: 300,
        cacheCreation: 200,
        cacheRead: 50,
        totalTokens: 1750,
        usageMissing: false
      }));
      expect(recordRequest).toHaveBeenCalledWith(expect.objectContaining({
        toolType: 'claude-code',
        model: 'glm-4.6',
        originalModel: 'claude-3-7-sonnet',
        redirectedModel: 'glm-4.6'
      }));
    });

    it('should not call broadcastLog when allowBroadcast is false', () => {
      const broadcastLog = vi.fn();

      publishUsageLog({
        source: 'claude',
        tokens: { input: 100, output: 50 },
        broadcastLog,
        allowBroadcast: false,
      });

      expect(broadcastLog).not.toHaveBeenCalled();
    });

    it('should handle missing callback functions gracefully', () => {
      const result = publishUsageLog({
        source: 'claude',
        tokens: { input: 100, output: 50 },
      });

      expect(result).not.toBeNull();
      expect(result.cost).toBe(0);
    });
  });

  describe('publishFailureLog', () => {
    it('should return null if no broadcastLog provided', () => {
      const result = publishFailureLog({
        source: 'claude',
        message: 'error',
      });
      expect(result).toBeNull();
    });

    it('should call broadcastLog with failure payload', () => {
      const broadcastLog = vi.fn();

      const result = publishFailureLog({
        source: 'codex',
        metadata: { channel: 'ch1' },
        message: 'Connection failed',
        statusCode: 502,
        broadcastLog,
      });

      expect(result).not.toBeNull();
      expect(broadcastLog).toHaveBeenCalledTimes(1);
      const payload = broadcastLog.mock.calls[0][0];
      expect(payload.status).toBe('error');
      expect(payload.message).toBe('Connection failed');
    });

    it('should keep the richer message when raw error is shorter', () => {
      const broadcastLog = vi.fn();

      publishFailureLog({
        source: 'claude',
        metadata: { channel: 'deepseek-channel' },
        message: 'OpenAI gateway network error: aborted',
        error: new Error('aborted'),
        stage: 'openai_gateway_network',
        broadcastLog
      });

      const payload = broadcastLog.mock.calls[0][0];
      expect(payload.channel).toBe('deepseek-channel');
      expect(payload.message).toBe('OpenAI gateway network error: aborted');
      expect(payload.rawError).toBe('aborted');
      expect(payload.stage).toBe('openai_gateway_network');
    });
  });
});
