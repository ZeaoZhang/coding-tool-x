const {
  normalizeSourceType,
  convertToOpenCodePayload,
  convertClaudeToOpenCodePayload,
  convertGeminiToOpenCodePayload
} = require('../../../src/platforms/drivers/opencode/gateway-converter');

describe('opencode-gateway-converter', () => {
  test('normalizes source aliases and rejects unsupported sources or target APIs', () => {
    expect(normalizeSourceType(' Claude_Code ')).toBe('claude');
    expect(normalizeSourceType('codex-cli')).toBe('codex');
    expect(normalizeSourceType('GEMINI_CLI')).toBe('gemini');

    expect(() => convertToOpenCodePayload({
      sourceType: 'unknown',
      payload: {}
    })).toThrow('Unsupported sourceType: unknown');

    expect(() => convertClaudeToOpenCodePayload({
      payload: {},
      options: { targetApi: 'xml' }
    })).toThrow('Unsupported targetApi: xml');
  });

  test('converts Claude payloads to OpenCode responses requests with tool normalization and warnings', () => {
    const result = convertClaudeToOpenCodePayload({
      payload: {
        model: 'claude-3-7-sonnet',
        system: [{ type: 'text', text: 'Follow the safety policy.' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello world' },
              { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
            ]
          },
          {
            role: 'system',
            content: 'secondary instruction'
          }
        ],
        tools: [
          {
            name: 'search',
            description: 'Search docs',
            input_schema: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              }
            }
          }
        ],
        max_output_tokens: 64,
        temperature: 0.4,
        stream: true
      }
    });

    expect(result).toEqual({
      sourceType: 'claude',
      target: 'opencode',
      targetApi: 'responses',
      endpoint: '/v1/responses',
      requestBody: {
        model: 'claude-3-7-sonnet',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'hello world'
              }
            ]
          }
        ],
        stream: true,
        store: false,
        instructions: 'Follow the safety policy.',
        max_output_tokens: 64,
        tools: [
          {
            type: 'function',
            name: 'search',
            description: 'Search docs',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              }
            }
          }
        ],
        temperature: 0.4
      },
      warnings: [
        'Claude message 0 contains non-text content; only text was preserved.',
        'Claude message 1 has role=system; merged into instructions.'
      ],
      meta: {
        model: 'claude-3-7-sonnet',
        messageCount: 1,
        hasSystemInstruction: true
      }
    });
  });

  test('converts Gemini payloads to chat.completions requests and preserves tool metadata', () => {
    const result = convertGeminiToOpenCodePayload({
      payload: {
        model: 'gemini-2.5-pro',
        systemInstruction: {
          parts: [{ text: 'Use concise answers.' }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Summarize the diff' }]
          },
          {
            role: 'model',
            parts: [{ text: 'Here is the summary.' }]
          }
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'lookup',
                description: 'Lookup docs',
                parameters: { type: 'object', properties: {} }
              }
            ]
          }
        ]
      },
      options: {
        targetApi: 'chat'
      }
    });

    expect(result).toEqual({
      sourceType: 'gemini',
      target: 'opencode',
      targetApi: 'chat.completions',
      endpoint: '/v1/chat/completions',
      requestBody: {
        model: 'gemini-2.5-pro',
        messages: [
          { role: 'system', content: 'Use concise answers.' },
          { role: 'user', content: 'Summarize the diff' },
          { role: 'assistant', content: 'Here is the summary.' }
        ],
        stream: false,
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup',
              description: 'Lookup docs',
              parameters: { type: 'object', properties: {} }
            }
          }
        ]
      },
      warnings: [],
      meta: {
        model: 'gemini-2.5-pro',
        messageCount: 2,
        hasSystemInstruction: true
      }
    });
  });

  test('requests usage in streaming chat.completions conversions', () => {
    const result = convertGeminiToOpenCodePayload({
      payload: {
        model: 'gemini-2.5-pro',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Summarize the diff' }]
          }
        ],
        generationConfig: {
          temperature: 0.2
        },
        stream: true
      },
      options: {
        targetApi: 'chat'
      }
    });

    expect(result.requestBody.stream).toBe(true);
    expect(result.requestBody.stream_options).toEqual({
      include_usage: true
    });
  });
});
