const {
  parseSSEUsage,
  parseNonStreamingUsage,
  splitSSEEvents,
  parseSSEEventText,
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

  test('parses OpenAI-compatible chat usage fields from OpenCode providers', () => {
    const parsed = parseNonStreamingUsage({
      model: 'qwen-max',
      usage: {
        prompt_tokens: 2048,
        completion_tokens: 128,
        cached_tokens: 1024,
        prompt_tokens_details: {
          cache_creation_input_tokens: 512
        },
        completion_tokens_details: {
          reasoning_tokens: 64
        }
      }
    });

    expect(parsed.tokens).toEqual({
      input: 1024,
      output: 128,
      total: 2176,
      cacheCreation: 512,
      cached: 1024,
      reasoning: 64
    });
    expect(parsed.model).toBe('qwen-max');
  });

  test('parses top-level reasoning_tokens from OpenCode chat completion samples', () => {
    const parsed = parseNonStreamingUsage({
      model: 'gemini-2.5-pro',
      usage: {
        prompt_tokens: 3767,
        completion_tokens: 19,
        prompt_tokens_details: {
          cached_tokens: 0
        },
        total_tokens: 3797,
        reasoning_tokens: 11
      }
    });

    expect(parsed.tokens).toEqual({
      input: 3767,
      output: 19,
      total: 3797,
      cached: 0,
      reasoning: 11
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

  test('parses Anthropic-compatible non-stream usage from GLM and MiniMax gateways', () => {
    const parsed = parseNonStreamingUsage({
      type: 'message',
      model: 'MiniMax-M2.5',
      usage: {
        input_tokens: 43,
        output_tokens: 32,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }
    });

    expect(parsed).toEqual({
      model: 'MiniMax-M2.5',
      tokens: {
        input: 43,
        output: 32,
        cacheCreation: 0,
        cacheRead: 0
      },
      isDone: false
    });
  });

  test('parses Claude message_start usage from nested message payloads', () => {
    const parsed = parseSSEUsage({
      type: 'message_start',
      message: {
        model: 'claude-opus-4-5',
        usage: {
          input_tokens: 3,
          output_tokens: 1,
          cache_creation_input_tokens: 11543,
          cache_read_input_tokens: 0
        }
      }
    }, 'message_start');

    expect(parsed).toEqual({
      model: 'claude-opus-4-5',
      tokens: {
        input: 3,
        output: 1,
        cacheCreation: 11543,
        cacheRead: 0
      },
      isDone: false
    });
  });

  test('parses Gemini usageMetadata reasoning and cache fields', () => {
    const parsed = parseNonStreamingUsage({
      model: 'gemini-2.5-pro',
      usageMetadata: {
        promptTokenCount: 512,
        candidatesTokenCount: 64,
        totalTokenCount: 576,
        cachedContentTokenCount: 128,
        thoughtsTokenCount: 33
      }
    });

    expect(parsed.tokens).toEqual({
      input: 512,
      output: 64,
      total: 576,
      cached: 128,
      reasoning: 33
    });
  });

  test('splits and parses CRLF-framed Gemini SSE usage events', () => {
    const frame = [
      'data: {"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1,"totalTokenCount":134,"thoughtsTokenCount":128},"modelVersion":"gemini-3.1-pro-preview"}',
      '',
      ''
    ].join('\r\n');
    const { events, remainder } = splitSSEEvents(frame);
    const event = parseSSEEventText(events[0]);
    const parsed = parseSSEUsage(JSON.parse(event.data), event.eventType);

    expect(events).toHaveLength(1);
    expect(remainder).toBe('');
    expect(parsed.tokens).toEqual({
      input: 5,
      output: 1,
      total: 134,
      reasoning: 128
    });
  });

  test('treats response.incomplete as a terminal responses API event', () => {
    const parsed = parseSSEUsage({
      type: 'response.incomplete',
      response: {
        model: 'o3-mini',
        usage: {
          input_tokens: 300,
          output_tokens: 20,
          output_tokens_details: {
            reasoning_tokens: 10
          }
        }
      }
    }, 'response.incomplete');

    expect(parsed).toEqual({
      model: 'o3-mini',
      tokens: {
        input: 300,
        output: 20,
        total: 320,
        reasoning: 10
      },
      isDone: true
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
