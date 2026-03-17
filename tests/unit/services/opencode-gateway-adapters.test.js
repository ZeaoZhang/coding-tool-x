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

  test('converts payloads to Codex responses format and strips unsupported fields', () => {
    const converted = convertOpenCodePayloadToCodexResponses({
      model: 'gpt-5.2',
      input: 'hello world',
      include: ['usage'],
      max_output_tokens: 120,
      temperature: 0.8,
      user: 'user-1'
    });

    expect(converted).toEqual({
      model: 'gpt-5.2',
      requestBody: {
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
        include: ['usage', 'reasoning.encrypted_content']
      }
    });
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
});
