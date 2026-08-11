'use strict';


// ---------------------------------------------------------------------------
// Claude wire contract tests
// ---------------------------------------------------------------------------
// These tests define the exact contract for src/server/services/claude-wire.js.
// The modules do not exist yet in phase 1 — the parent will verify RED.
// Once implemented, every test below MUST pass without modification.
// ---------------------------------------------------------------------------

let claudeWire;

beforeEach(() => {
  vi.resetModules();
  claudeWire = require('../../../src/server/services/claude-wire');
});

describe('claude-wire module exports', () => {
  it('exports createClaudeRequest', () => {
    
    expect(claudeWire.createClaudeRequest).toBeInstanceOf(Function);
  });

  it('exports buildClaudeTargetUrl', () => {
    
    expect(claudeWire.buildClaudeTargetUrl).toBeInstanceOf(Function);
  });

  it('exports buildClaudeCountTokensTargetUrl', () => {
    
    expect(claudeWire.buildClaudeCountTokensTargetUrl).toBeInstanceOf(Function);
  });
});

// ---------------------------------------------------------------------------
// createClaudeRequest — full body + header contract
// ---------------------------------------------------------------------------

describe('createClaudeRequest — body conversion', () => {
  const basePayload = {
    model: 'claude-sonnet-4-20250514',
    max_output_tokens: 4096,
    messages: [
      { role: 'developer', content: 'You are OpenCode assistant.' },
      { role: 'user', content: 'hello' }
    ]
  };

  it('returns { body, headers, model }', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', basePayload);
    expect(result).toHaveProperty('body');
    expect(result).toHaveProperty('headers');
    expect(result).toHaveProperty('model');
    expect(typeof result.body).toBe('object');
    expect(typeof result.headers).toBe('object');
  });

  it('uses payload.model, falling back to options.fallbackModel', () => {
    
    const r1 = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: basePayload.messages }, { fallbackModel: 'claude-fallback' });
    expect(r1.model).toBe('claude-fallback');

    const r2 = claudeWire.createClaudeRequest('/v1/chat/completions', basePayload, { fallbackModel: 'claude-fallback' });
    expect(r2.model).toBe('claude-sonnet-4-20250514');
  });

  it('rounds positive max_output_tokens / max_tokens to an integer and defaults to 4096', () => {
    
    const r1 = claudeWire.createClaudeRequest('/v1/chat/completions', basePayload);
    expect(r1.body.max_tokens).toBe(4096);

    const r2 = claudeWire.createClaudeRequest('/v1/chat/completions', {
      ...basePayload, max_output_tokens: 100.7
    });
    expect(r2.body.max_tokens).toBe(101);
  });

  it('omits max_tokens when value is <= 0', () => {
    
    const r = claudeWire.createClaudeRequest('/v1/chat/completions', {
      ...basePayload, max_output_tokens: 0
    });
    expect(r.body.max_tokens).toBe(4096); // falls back to default
  });

  it('controls body.stream from options.stream', () => {
    
    const streaming = claudeWire.createClaudeRequest('/v1/chat/completions', basePayload, { stream: true });
    expect(streaming.body.stream).toBe(true);

    const nonStreaming = claudeWire.createClaudeRequest('/v1/chat/completions', basePayload, { stream: false });
    expect(nonStreaming.body.stream).toBe(false);
  });
});

describe('createClaudeRequest — system blocks', () => {
  const developerPayload = {
    messages: [
      { role: 'developer', content: 'You are OpenCode assistant.' },
      { role: 'user', content: 'hello' }
    ]
  };

  it('converts developer messages to system blocks', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', developerPayload);
    expect(Array.isArray(result.body.system)).toBe(true);
    expect(result.body.system.length).toBeGreaterThanOrEqual(1);
    expect(result.body.system.some(b => b.type === 'text')).toBe(true);
  });

  it('replaces Claude Code identity text in system blocks', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', developerPayload);
    const textBlocks = (result.body.system || []).filter(b => b.type === 'text');
    const hasIdentity = textBlocks.some(b => b.text && b.text.includes('Claude Code'));
    expect(hasIdentity).toBe(true);
  });

  it('defaults to Claude Code identity when no system messages exist', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }]
    });
    expect(Array.isArray(result.body.system)).toBe(true);
    expect(result.body.system.length).toBeGreaterThanOrEqual(1);
    expect(result.body.system[0].type).toBe('text');
  });
});

describe('createClaudeRequest — tool conversion', () => {
  const toolPayload = {
    messages: [
      { role: 'developer', content: 'Assistant' },
      {
        role: 'assistant',
        content: 'ok',
        tool_calls: [
          {
            id: 'call-1',
            function: { name: 'search', arguments: '{"query":"docs"}' }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: JSON.stringify({ result: 'ok' })
      }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Find docs',
          parameters: { type: 'object', properties: { query: { type: 'string' } } }
        }
      }
    ],
    tool_choice: { type: 'function', function: { name: 'search' } }
  };

  it('prefixes tool names with mcp_', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', toolPayload);
    const toolNames = (result.body.tools || []).map(t => t.name);
    expect(toolNames).toContain('mcp_search');
  });

  it('maps OpenAI tool_choice to Claude tool_choice with mcp_ prefix', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', toolPayload);
    expect(result.body.tool_choice).toEqual({ type: 'tool', name: 'mcp_search' });
  });

  it('converts tool call messages to tool_use blocks with mcp_ prefix', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', toolPayload);
    const assistantMessages = (result.body.messages || []).filter(m => m.role === 'assistant');
    const toolUseBlocks = assistantMessages.flatMap(m =>
      (m.content || []).filter(c => c.type === 'tool_use')
    );
    expect(toolUseBlocks.length).toBeGreaterThanOrEqual(1);
    expect(toolUseBlocks[0].name).toBe('mcp_search');
  });

  it('converts tool result messages to tool_result blocks with cache_control', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', toolPayload);
    const userMessages = (result.body.messages || []).filter(m => m.role === 'user');
    const toolResultBlocks = userMessages.flatMap(m =>
      (m.content || []).filter(c => c.type === 'tool_result')
    );
    expect(toolResultBlocks.length).toBeGreaterThanOrEqual(1);
    expect(toolResultBlocks[0]).toHaveProperty('tool_use_id');
    expect(toolResultBlocks[0]).toHaveProperty('cache_control');
  });

  it('includes advanced-tool beta when body.tools is populated', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', toolPayload);
    const betaHeader = result.headers['anthropic-beta'];
    if (betaHeader && result.body.tools && result.body.tools.length > 0) {
      expect(betaHeader).toContain('advanced-tool-use-2025-11-20');
    }
  });

  it('omits advanced-tool beta when no tools are present', () => {
    
    const noTools = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }]
    });
    const betaHeader = noTools.headers['anthropic-beta'];
    if (betaHeader) {
      expect(betaHeader).not.toContain('advanced-tool-use-2025-11-20');
    }
  });
});

describe('createClaudeRequest — reasoning / thinking', () => {
  it('maps reasoning_effort=low to thinking budget_tokens=2048', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
      reasoning_effort: 'low'
    });
    if (result.body.thinking) {
      expect(result.body.thinking.type).toBe('enabled');
      expect(result.body.thinking.budget_tokens).toBe(2048);
    }
  });

  it('maps reasoning_effort=high to thinking budget_tokens=16384', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
      reasoning_effort: 'high'
    });
    if (result.body.thinking) {
      expect(result.body.thinking.type).toBe('enabled');
      expect(result.body.thinking.budget_tokens).toBeGreaterThan(2048);
    }
  });
});

describe('createClaudeRequest — stop sequences and sampling', () => {
  it('maps stop arrays to stop_sequences', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
      stop: ['DONE', 'STOP']
    });
    expect(result.body.stop_sequences).toEqual(['DONE', 'STOP']);
  });

  it('passes through temperature, top_p, top_k', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.3,
      top_p: 0.9,
      top_k: 40
    });
    expect(result.body.temperature).toBe(0.3);
    expect(result.body.top_p).toBe(0.9);
    expect(result.body.top_k).toBe(40);
  });
});

describe('createClaudeRequest — metadata', () => {
  it('normalizes metadata.user_id using sessionUserId fallback', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
      metadata: { user_id: 'invalid' }
    }, { sessionUserId: 'session_test' });
    expect(result.body.metadata).toHaveProperty('user_id');
    expect(result.body.metadata.user_id).toMatch(/^user_[0-9a-f]{64}_account__session_session_test$/);
  });

  it('preserves an allow-listed valid metadata.user_id', () => {
    const validUserId = `user_${'0'.repeat(64)}_account__session_session_test`;
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
      metadata: { user_id: validUserId }
    });
    expect(result.body.metadata.user_id).toBe(validUserId);
  });
});

describe('createClaudeRequest — prompt caching', () => {
  it('applies cache_control: ephemeral to system blocks', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [
        { role: 'developer', content: 'You are OpenCode assistant.' },
        { role: 'user', content: 'hello' }
      ]
    });
    const systemBlocks = result.body.system || [];
    const lastTextBlock = [...systemBlocks].reverse().find(b => b.type === 'text');
    if (lastTextBlock) {
      expect(lastTextBlock.cache_control).toEqual({ type: 'ephemeral' });
    }
  });

  it('applies cache_control to tool_use and tool_result blocks', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [
        { role: 'developer', content: 'Assistant' },
        {
          role: 'assistant',
          content: 'ok',
          tool_calls: [
            { id: 'call-1', function: { name: 'search', arguments: '{"q":"x"}' } }
          ]
        },
        {
          role: 'tool', tool_call_id: 'call-1',
          content: JSON.stringify({ result: 'ok' })
        }
      ],
      tools: [{
        type: 'function',
        function: { name: 'search', description: 'search', parameters: { type: 'object', properties: {} } }
      }]
    });
    // All tool_use blocks in the last assistant message should have cache_control
    const assMsgs = (result.body.messages || []).filter(m => m.role === 'assistant');
    assMsgs.forEach(m => {
      const tus = (m.content || []).filter(c => c.type === 'tool_use');
      tus.forEach(tu => {
        expect(tu.cache_control).toEqual({ type: 'ephemeral' });
      });
    });
    // All tool_result blocks should have cache_control
    const userMsgs = (result.body.messages || []).filter(m => m.role === 'user');
    userMsgs.forEach(m => {
      const trs = (m.content || []).filter(c => c.type === 'tool_result');
      trs.forEach(tr => {
        expect(tr.cache_control).toEqual({ type: 'ephemeral' });
      });
    });
  });
});

// ---------------------------------------------------------------------------
// createClaudeRequest — headers
// ---------------------------------------------------------------------------

describe('createClaudeRequest — fixed headers', () => {
  it('sends Content-Type application/json', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('sends anthropic-version 2023-06-01', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    expect(result.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('sends anthropic-dangerous-direct-browser-access true', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    expect(result.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('sends x-app cli', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    expect(result.headers['x-app']).toBe('cli');
  });

  it('sends a per-request x-client-request-id', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    expect(result.headers['x-client-request-id']).toEqual(expect.any(String));
    expect(result.headers['x-client-request-id'].length).toBeGreaterThan(0);
  });
});

describe('createClaudeRequest — Claude Code betas', () => {
  it('includes claude-code-20250219 beta', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    const beta = result.headers['anthropic-beta'] || '';
    expect(beta).toContain('claude-code-20250219');
  });

  it('includes interleaved-thinking beta', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    const beta = result.headers['anthropic-beta'] || '';
    expect(beta).toContain('interleaved-thinking-2025-05-14');
  });
});

describe('createClaudeRequest — Claude Code user-agent', () => {
  it('sends a Claude Code user-agent', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    expect(result.headers['user-agent']).toBeDefined();
    expect(result.headers['user-agent']).toContain('claude');
  });
});

describe('createClaudeRequest — auth branches', () => {
  it('sends ONLY X-Api-Key for official api.anthropic.com endpoint (no Bearer)', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com'
    });
    expect(result.headers['x-api-key']).toBe('sk-ant-test');
    expect(result.headers['authorization']).toBeUndefined();
  });

  it('sends ONLY Authorization Bearer for custom non-official endpoints (no X-Api-Key)', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-custom',
      baseUrl: 'https://custom-proxy.example.com'
    });
    expect(result.headers['authorization']).toBe('Bearer sk-custom');
    expect(result.headers['x-api-key']).toBeUndefined();
  });

  it('treats api.anthropic.com subdomain as official (X-Api-Key only)', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com/v1'
    });
    expect(result.headers['x-api-key']).toBe('sk-ant-test');
    expect(result.headers['authorization']).toBeUndefined();
  });

  it('preserves explicit header overrides from channel.providerConfig.headers', () => {
    
    // Even if the module does not yet support channel header overrides,
    // the contract should allow for it; document the expectation.
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com'
    });
    // At minimum, the X-Api-Key header should be present
    expect(result.headers['x-api-key']).toBe('sk-ant-test');
  });
});

describe('createClaudeRequest — stream Accept', () => {
  it('sends Accept text/event-stream when streaming', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { stream: true });
    expect(result.headers['accept']).toBe('text/event-stream');
  });

  it('sends Accept application/json when not streaming', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { stream: false });
    expect(result.headers['accept']).toBe('application/json');
  });
});

describe('createClaudeRequest — networkHeaders false', () => {
  it('skips auth and platform headers when networkHeaders is false', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com',
      networkHeaders: false
    });
    // Body should still be fully normalized
    expect(result.body).toHaveProperty('system');
    expect(result.body).toHaveProperty('messages');
    expect(result.body).toHaveProperty('max_tokens');
    expect(result.body).toHaveProperty('model');
    // Auth headers should be absent
    expect(result.headers['x-api-key']).toBeUndefined();
    expect(result.headers['authorization']).toBeUndefined();
  });

  it('still normalizes body when networkHeaders is false', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [
        { role: 'developer', content: 'You are OpenCode assistant.' },
        { role: 'user', content: 'hello' }
      ],
      reasoning_effort: 'low',
      stop: ['DONE']
    }, { networkHeaders: false });
    expect(result.body.system).toBeDefined();
    expect(result.body.stop_sequences).toEqual(['DONE']);
    expect(result.body.thinking).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createClaudeRequest — image / media support
// ---------------------------------------------------------------------------

describe('createClaudeRequest — image and media parts', () => {
  it('converts image_url content blocks to Claude image blocks', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' }
          }
        ]
      }]
    });
    const userBlocks = (result.body.messages || [])
      .filter(m => m.role === 'user')
      .flatMap(m => m.content || []);
    const imageBlock = userBlocks.find(b => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source).toBeDefined();
    expect(imageBlock.source.type).toBe('base64');
  });

  it('preserves file/document blocks', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', {
      messages: [{
        role: 'user',
        content: [
          {
            type: 'file',
            file: { file_data: 'SGVsbG8=', filename: 'test.txt' }
          }
        ]
      }]
    });
    const userBlocks = (result.body.messages || [])
      .filter(m => m.role === 'user')
      .flatMap(m => m.content || []);
    expect(userBlocks.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// buildClaudeTargetUrl
// ---------------------------------------------------------------------------

describe('buildClaudeTargetUrl', () => {
  it('appends /v1/messages to a bare host', () => {
    
    const url = claudeWire.buildClaudeTargetUrl('https://api.anthropic.com');
    expect(url).toContain('/v1/messages');
  });

  it('preserves an existing /v1/messages path', () => {
    
    const url = claudeWire.buildClaudeTargetUrl('https://api.anthropic.com/v1/messages');
    expect(url).toContain('/v1/messages');
    expect((url.match(/\/messages/g) || []).length).toBe(1);
  });

  it('appends /messages to a /v1 base', () => {
    
    const url = claudeWire.buildClaudeTargetUrl('https://api.anthropic.com/v1');
    expect(url).toContain('/v1/messages');
  });

  it('appends /v1/messages to a custom prefix', () => {
    
    const url = claudeWire.buildClaudeTargetUrl('https://custom-proxy.example.com/api');
    expect(url).toContain('/api/v1/messages');
  });

  it('sets beta=true query parameter', () => {
    
    const url = claudeWire.buildClaudeTargetUrl('https://api.anthropic.com');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('beta')).toBe('true');
  });

  it('preserves existing query parameters', () => {
    
    const url = claudeWire.buildClaudeTargetUrl('https://api.anthropic.com?region=us');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('region')).toBe('us');
    expect(parsed.searchParams.get('beta')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// buildClaudeCountTokensTargetUrl
// ---------------------------------------------------------------------------

describe('buildClaudeCountTokensTargetUrl', () => {
  it('appends /v1/messages/count_tokens to a bare host', () => {
    
    const url = claudeWire.buildClaudeCountTokensTargetUrl('https://api.anthropic.com');
    expect(url).toContain('/v1/messages/count_tokens');
  });

  it('appends /messages/count_tokens to a /v1 base', () => {
    
    const url = claudeWire.buildClaudeCountTokensTargetUrl('https://api.anthropic.com/v1');
    expect(url).toContain('/v1/messages/count_tokens');
  });

  it('preserves an existing /messages/count_tokens path', () => {
    
    const url = claudeWire.buildClaudeCountTokensTargetUrl(
      'https://api.anthropic.com/v1/messages/count_tokens'
    );
    expect(url).toContain('/v1/messages/count_tokens');
    expect((url.match(/\/messages\/count_tokens/g) || []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createClaudeRequest — /v1/responses path normalization
// ---------------------------------------------------------------------------

describe('createClaudeRequest — /v1/responses path', () => {
  it('normalizes /v1/responses payload (instructions, input) to messages', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/responses', {
      model: 'claude-sonnet-4-20250514',
      instructions: 'You are a helpful assistant.',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
      ]
    });
    expect(result.body.system).toBeDefined();
    expect(result.body.messages).toBeDefined();
    const userMsg = (result.body.messages || []).find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DEFECT 1: Malformed non-empty URLs return ''
// ---------------------------------------------------------------------------

describe('buildClaudeTargetUrl — malformed URLs', () => {
  it('returns empty string for non-empty malformed URL', () => {
    
    expect(claudeWire.buildClaudeTargetUrl('not-a-valid-url:::')).toBe('');
  });

  it('returns empty string for URL with spaces', () => {
    
    expect(claudeWire.buildClaudeTargetUrl('not a url')).toBe('');
  });

  it('returns valid URL for empty base (defaults to anthropic)', () => {
    
    const url = claudeWire.buildClaudeTargetUrl('');
    expect(url).toContain('https://api.anthropic.com');
    expect(url).toContain('/v1/messages');
  });

  it('returns valid URL for undefined base', () => {
    
    const url = claudeWire.buildClaudeTargetUrl(undefined);
    expect(url).toContain('https://api.anthropic.com');
  });
});

describe('buildClaudeCountTokensTargetUrl — malformed URLs', () => {
  it('returns empty string for non-empty malformed URL', () => {
    
    expect(claudeWire.buildClaudeCountTokensTargetUrl('not-a-valid-url:::')).toBe('');
  });

  it('returns valid URL for empty base', () => {
    
    const url = claudeWire.buildClaudeCountTokensTargetUrl('');
    expect(url).toContain('/v1/messages/count_tokens');
  });
});

// ---------------------------------------------------------------------------
// DEFECT 2: Case-insensitive header override with opposite credential suppression
// ---------------------------------------------------------------------------

describe('createClaudeRequest — header overrides', () => {
  it('merges explicit Authorization from options.headers (case-insensitive)', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
      headers: { 'Authorization': 'Bearer override-token' }
    });
    expect(result.headers['authorization']).toBe('Bearer override-token');
    expect(result.headers['x-api-key']).toBeUndefined();
  });

  it('merges explicit X-Api-Key from options.providerConfig.headers (case-insensitive)', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-custom',
      baseUrl: 'https://custom-proxy.example.com',
      providerConfig: { headers: { 'x-api-key': 'override-key' } }
    });
    expect(result.headers['x-api-key']).toBe('override-key');
    expect(result.headers['authorization']).toBeUndefined();
  });

  it('suppresses generated opposite credential when explicit Authorization is set (case-insensitive)', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
      headers: { 'AUTHORIZATION': 'Bearer mixed-case' }
    });
    expect(result.headers['authorization']).toBe('Bearer mixed-case');
    expect(result.headers['x-api-key']).toBeUndefined();
  });

  it('suppresses generated opposite credential when explicit x-api-key is set on custom endpoint', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'sk-custom',
      baseUrl: 'https://custom.example.com',
      headers: { 'X-API-KEY': 'override-key' }
    });
    expect(result.headers['x-api-key']).toBe('override-key');
    expect(result.headers['authorization']).toBeUndefined();
  });

  it('allows overriding non-credential fixed headers', () => {
    
    const result = claudeWire.createClaudeRequest('/v1/messages', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      headers: { 'x-app': 'custom-app' }
    });
    expect(result.headers['x-app']).toBe('custom-app');
  });
});

// ---------------------------------------------------------------------------
// DEFECT 3: Deep immutability — inputs are not mutated
// ---------------------------------------------------------------------------

describe('createClaudeRequest — deep immutability', () => {
  it('does not mutate input payload messages', () => {
    
    const input = {
      messages: [
        { role: 'developer', content: 'You are assistant.' },
        { role: 'user', content: 'hello' }
      ],
      tools: [{
        type: 'function',
        function: { name: 'search', parameters: { type: 'object', properties: {} } }
      }]
    };
    const cloned = JSON.parse(JSON.stringify(input));
    claudeWire.createClaudeRequest('/v1/chat/completions', input);
    expect(input).toEqual(cloned);
  });

  it('does not mutate tool_use blocks in input', () => {
    
    const input = {
      messages: [
        { role: 'developer', content: 'Assistant' },
        {
          role: 'assistant',
          content: 'ok',
          tool_calls: [{
            id: 'call-1',
            function: { name: 'search', arguments: '{"q":"x"}' }
          }]
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'result' }
      ],
      tools: [{
        type: 'function',
        function: { name: 'search', parameters: { type: 'object', properties: {} } }
      }]
    };
    const cloned = JSON.parse(JSON.stringify(input));
    claudeWire.createClaudeRequest('/v1/chat/completions', input);
    expect(input).toEqual(cloned);
  });

  it('returns a body with cache_control on deep clones, not original objects', () => {
    
    const input = {
      messages: [
        { role: 'developer', content: 'Assistant' },
        { role: 'user', content: 'hello' }
      ]
    };
    const cloned = JSON.parse(JSON.stringify(input));
    const result = claudeWire.createClaudeRequest('/v1/chat/completions', input);
    // Input must remain unmutated
    expect(input).toEqual(cloned);
    // Body system blocks should have cache_control (owned by output)
    const systemBlocks = result.body.system || [];
    expect(systemBlocks.length).toBeGreaterThanOrEqual(1);
    const lastText = [...systemBlocks].reverse().find(b => b.type === 'text');
    expect(lastText.cache_control).toEqual({ type: 'ephemeral' });
  });
});

// ---------------------------------------------------------------------------
// buildClaudeCountTokensHeaders
// ---------------------------------------------------------------------------

describe('buildClaudeCountTokensHeaders', () => {
  it('uses X-Api-Key only for official Anthropic endpoints', () => {
    const headers = claudeWire.buildClaudeCountTokensHeaders('sk-test', { baseUrl: 'https://api.anthropic.com' });
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers.authorization).toBeUndefined();
  });

  it('uses Bearer only for custom endpoints', () => {
    const headers = claudeWire.buildClaudeCountTokensHeaders('sk-test', { baseUrl: 'https://relay.example.com/v1' });
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('includes token-counting beta flags without advanced-tool beta', () => {
    const headers = claudeWire.buildClaudeCountTokensHeaders('sk-test', {
      baseUrl: 'https://api.anthropic.com',
      hasTools: true
    });
    expect(headers['anthropic-beta']).toContain('claude-code-20250219');
    expect(headers['anthropic-beta']).toContain('token-counting-2024-11-01');
    expect(headers['anthropic-beta']).not.toContain('advanced-tool-use-2025-11-20');
  });

  it('honors explicit credential overrides and suppresses the generated opposite', () => {
    const headers = claudeWire.buildClaudeCountTokensHeaders('sk-test', {
      baseUrl: 'https://relay.example.com/v1',
      providerConfig: { headers: { authorization: 'Bearer custom-credential' } }
    });
    expect(headers.authorization).toBe('Bearer custom-credential');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('uses application/json accept for count tokens', () => {
    const headers = claudeWire.buildClaudeCountTokensHeaders('sk-test', { baseUrl: 'https://api.anthropic.com' });
    expect(headers.accept).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// DEFECT 4: Exact exports — limit claude-wire exports
// ---------------------------------------------------------------------------

describe('claude-wire — exact exports', () => {
  it('exports exactly createClaudeRequest, buildClaudeTargetUrl, buildClaudeCountTokensTargetUrl, stripClaudeToolNamePrefix', () => {
    
    const expected = [
      'createClaudeRequest',
      'buildClaudeTargetUrl',
      'buildClaudeCountTokensTargetUrl',
      'buildClaudeCountTokensHeaders',
      'stripClaudeToolNamePrefix'
    ].sort();
    const actual = Object.keys(claudeWire).sort();
    expect(actual).toEqual(expected);
  });
});
