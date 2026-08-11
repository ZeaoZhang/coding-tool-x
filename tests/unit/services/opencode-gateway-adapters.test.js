'use strict';

const {
  convertOpenCodePayloadToClaude,
  convertOpenCodePayloadToCodexResponses,
  convertOpenCodePayloadToGemini,
  stripClaudeToolNamePrefix
} = require('../../../src/server/services/opencode-gateway-adapters');

describe('opencode-gateway-adapters', () => {
  test('converts chat.completions payloads to Claude format with prefixed tool names and metadata fallback', () => {
    const converted = convertOpenCodePayloadToClaude('/v1/chat/completions', {
      messages: [
        { role: 'developer', content: 'You are OpenCode assistant.' },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: 'working on it',
          tool_calls: [
            {
              id: 'call-1',
              function: {
                name: 'search',
                arguments: '{"query":"docs"}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call-1',
          content: { result: 'ok' }
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'OpenCode search',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              }
            }
          }
        }
      ],
      tool_choice: {
        type: 'function',
        function: { name: 'search' }
      },
      reasoning_effort: 'low',
      stop: ['DONE'],
      metadata: { user_id: 'invalid-user-id' },
      temperature: 0.3
    }, 'claude-sonnet-fallback', {
      sessionUserId: 'session_test'
    });

    expect(converted.model).toBe('claude-sonnet-fallback');
    expect(converted.max_tokens).toBe(4096);
    expect(converted.system[0].text).toBe('You are Claude Code assistant.');
    expect(converted.tools).toEqual([
      {
        name: 'mcp_search',
        description: 'Claude Code search',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          }
        }
      }
    ]);
    expect(converted.tool_choice).toEqual({ type: 'tool', name: 'mcp_search' });
    expect(converted.stop_sequences).toEqual(['DONE']);
    expect(converted.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    expect(converted.temperature).toBe(0.3);
    expect(converted.metadata.user_id).toMatch(/^user_[0-9a-f]{64}_account__session_session_test$/);
    expect(converted.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(converted.messages[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'hello'
        }
      ]
    });
    expect(converted.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'working on it' },
        {
          type: 'tool_use',
          id: 'call-1',
          name: 'mcp_search',
          input: { query: 'docs' },
          cache_control: { type: 'ephemeral' }
        }
      ]
    });
    expect(converted.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: '{"result":"ok"}',
          cache_control: { type: 'ephemeral' }
        }
      ]
    });
  });

  test('converts payloads to Codex responses format with current compatibility metadata', () => {
    const converted = convertOpenCodePayloadToCodexResponses({
      model: 'gpt-5.2',
      input: 'hello world',
      include: ['usage'],
      max_output_tokens: 120,
      temperature: 0.8,
      user: 'user-1',
      prompt_cache_key: 'adapter-session'
    });

    expect(converted.model).toBe('gpt-5.2');
    expect(converted.requestBody).toEqual(expect.objectContaining({
      model: 'gpt-5.2',
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
      parallel_tool_calls: true,
      instructions: '',
      include: ['usage', 'reasoning.encrypted_content'],
      prompt_cache_key: 'adapter-session'
    }));
    expect(converted.requestBody.client_metadata).toEqual(expect.objectContaining({
      session_id: 'adapter-session',
      thread_id: 'adapter-session',
      'x-codex-installation-id': expect.any(String),
      'x-codex-window-id': expect.any(String),
      'x-codex-turn-metadata': expect.any(String)
    }));
    expect(converted.requestBody.max_output_tokens).toBeUndefined();
    expect(converted.requestBody.temperature).toBeUndefined();
    expect(converted.requestBody.user).toBeUndefined();
  });

  test('converts responses payloads to Gemini format with function calls, tool config, and response modalities', () => {
    const converted = convertOpenCodePayloadToGemini('/v1/responses', {
      instructions: 'Use the docs.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }]
        },
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'lookup',
          arguments: '{"query":"docs"}'
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: { answer: 'ok' }
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Find docs',
            parameters: { type: 'object', properties: {} }
          }
        },
        {
          type: 'google_search',
          web_search: { mode: 'dynamic' }
        }
      ],
      tool_choice: 'required',
      reasoning_effort: 'high',
      max_output_tokens: 80,
      top_p: 0.8,
      modalities: ['text', 'image'],
      image_config: {
        aspect_ratio: '1:1'
      },
      n: 2
    }, 'gemini-2.5-pro');

    expect(converted).toEqual({
      model: 'gemini-2.5-pro',
      requestBody: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'hello' }]
          },
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'lookup',
                  args: { query: 'docs' }
                }
              }
            ]
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'lookup',
                  response: { answer: 'ok' }
                }
              }
            ]
          }
        ],
        systemInstruction: {
          parts: [{ text: 'Use the docs.' }]
        },
        generationConfig: {
          maxOutputTokens: 80,
          topP: 0.8,
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: 'high'
          },
          candidateCount: 2,
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: '1:1'
          }
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'lookup',
                description: 'Find docs',
                parameters: { type: 'object', properties: {} }
              }
            ]
          },
          {
            googleSearch: { mode: 'dynamic' }
          }
        ],
        toolConfig: {
          functionCallingConfig: { mode: 'ANY' }
        }
      }
    });
    expect(stripClaudeToolNamePrefix('mcp_lookup')).toBe('lookup');
  });
  test('convertOpenCodePayloadToClaude produces same body shape as future claude-wire delegation', () => {
    // This test verifies that when the adapter wraps claude-wire.js,
    // the current observable body contract is preserved. The fixture mirrors
    // the existing "converts chat.completions payloads" test above.
    const converted = convertOpenCodePayloadToClaude('/v1/chat/completions', {
      messages: [
        { role: 'developer', content: 'You are OpenCode assistant.' },
        { role: 'user', content: 'hello' }
      ],
      model: 'claude-sonnet-4-20250514',
      max_output_tokens: 1024,
      temperature: 0.7,
      stop: ['END'],
      reasoning_effort: 'medium',
      metadata: { user_id: 'invalid' }
    }, 'claude-fallback', {
      sessionUserId: 'session_test'
    });

    // The adapter output must match what createClaudeRequest(…, { networkHeaders: false }).body would produce
    expect(converted).toHaveProperty('model');
    expect(converted).toHaveProperty('max_tokens');
    expect(converted).toHaveProperty('system');
    expect(converted).toHaveProperty('messages');
    expect(converted.model).toBe('claude-sonnet-4-20250514');
    expect(converted.max_tokens).toBe(1024);
    expect(converted.temperature).toBe(0.7);
    expect(converted.stop_sequences).toEqual(['END']);
    expect(converted.thinking).toBeDefined();
    expect(converted.metadata).toBeDefined();
    expect(converted.metadata.user_id).toBeDefined();
    // The adapter wrapper should NOT include network headers — that's the wire module's job
    expect(converted.headers).toBeUndefined();
  });

  test('convertOpenCodePayloadToGemini produces same body shape as future gemini-wire delegation', () => {
    // This test verifies that when the adapter wraps gemini-wire.js,
    // the current observable body contract is preserved.
    const converted = convertOpenCodePayloadToGemini('/v1/responses', {
      model: 'gemini-2.5-pro',
      instructions: 'You are a helpful assistant.',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
        { type: 'function_call', call_id: 'call-1', name: 'search', arguments: '{"q":"x"}' },
        { type: 'function_call_output', call_id: 'call-1', output: { result: 'ok' } }
      ],
      tools: [{
        type: 'function',
        function: { name: 'search', parameters: { type: 'object', properties: {} } }
      }],
      tool_choice: 'required',
      max_output_tokens: 200,
      temperature: 0.5,
      modalities: ['text']
    }, 'gemini-fallback');

    // The output must match what createGeminiRequest(…, { networkHeaders: false, useCli: false }) would produce
    expect(converted).toHaveProperty('model');
    expect(converted).toHaveProperty('requestBody');
    expect(converted.model).toBe('gemini-2.5-pro');
    expect(converted.requestBody.contents).toBeDefined();
    expect(converted.requestBody.systemInstruction).toBeDefined();
    expect(converted.requestBody.generationConfig).toBeDefined();
    expect(converted.requestBody.tools).toBeDefined();
    expect(converted.requestBody.toolConfig).toBeDefined();
    // Adapter wrapper should NOT include headers
    expect(converted.requestBody.headers).toBeUndefined();
    expect(converted.headers).toBeUndefined();
  });

  test('stripClaudeToolNamePrefix preserves existing contract', () => {
    expect(stripClaudeToolNamePrefix('mcp_search')).toBe('search');
    expect(stripClaudeToolNamePrefix('search')).toBe('search');
    expect(stripClaudeToolNamePrefix('')).toBe('');
  });
});
