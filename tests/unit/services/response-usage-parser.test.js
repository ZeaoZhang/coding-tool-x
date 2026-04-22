const {
  parseSSEUsage,
  parseNonStreamingUsage,
  mergeUsageIntoTokenData,
  createTokenData
} = require('../../../src/server/services/base/response-usage-parser');

describe('response-usage-parser', () => {
  test('parses camelCase response.completed usage objects from compatible providers', () => {
    const parsed = parseSSEUsage({
      type: 'response.completed',
      response: {
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          totalTokens: 150,
          inputTokensDetails: {
            cachedTokens: 12
          },
          outputTokensDetails: {
            reasoningTokens: 8
          }
        }
      }
    }, 'response.completed');

    expect(parsed).toEqual({
      model: 'gpt-4o-mini',
      tokens: {
        input: 108,
        output: 30,
        total: 150,
        cached: 12,
        reasoning: 8
      },
      isDone: true
    });
  });

  test('parses top-level tokenUsage fallback objects', () => {
    const parsed = parseNonStreamingUsage({
      model: 'custom-model',
      tokenUsage: {
        promptTokens: 40,
        completionTokens: 10,
        totalTokens: 50
      }
    });

    expect(parsed.tokens).toEqual({
      input: 40,
      output: 10,
      total: 50
    });
    expect(parsed.model).toBe('custom-model');
  });

  test('keeps Anthropic input separate from cache creation/read fields', () => {
    const parsed = parseNonStreamingUsage({
      model: 'claude-sonnet',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 10
      }
    });

    expect(parsed.tokens).toEqual({
      input: 100,
      output: 20,
      cacheCreation: 30,
      cacheRead: 10
    });
  });

  test('merges parsed usage into tokenData state', () => {
    const tokenData = createTokenData();
    mergeUsageIntoTokenData(tokenData, {
      model: 'gemini-2.5-flash',
      tokens: {
        input: 100,
        output: 25,
        total: 125,
        cached: 5
      },
      isDone: true
    });

    expect(tokenData).toMatchObject({
      model: 'gemini-2.5-flash',
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      cachedTokens: 5
    });
  });
});
