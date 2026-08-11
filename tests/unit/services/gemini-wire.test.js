'use strict';


// ---------------------------------------------------------------------------
// Gemini wire contract tests
// ---------------------------------------------------------------------------
// These tests define the exact contract for src/server/services/gemini-wire.js.
// The modules do not exist yet in phase 1 — the parent will verify RED.
// Once implemented, every test below MUST pass without modification.
// ---------------------------------------------------------------------------

let geminiWire;

beforeEach(() => {
  vi.resetModules();
  geminiWire = require('../../../src/server/services/gemini-wire');
});

describe('gemini-wire module exports', () => {
  it('exports createGeminiRequest', () => {
    
    expect(geminiWire.createGeminiRequest).toBeInstanceOf(Function);
  });

  it('exports buildGeminiTargetUrl', () => {
    
    expect(geminiWire.buildGeminiTargetUrl).toBeInstanceOf(Function);
  });

  it('exports shouldUseGeminiCliFormat', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat).toBeInstanceOf(Function);
  });
});

// ---------------------------------------------------------------------------
// createGeminiRequest — return shape
// ---------------------------------------------------------------------------

describe('createGeminiRequest — return shape', () => {
  const basePayload = {
    model: 'gemini-2.5-pro',
    messages: [{ role: 'user', content: 'hello' }]
  };

  it('returns { body, headers, model, useCli }', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/chat/completions', basePayload, { useCli: false });
    expect(result).toHaveProperty('body');
    expect(result).toHaveProperty('headers');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('useCli');
    expect(typeof result.body).toBe('object');
    expect(typeof result.headers).toBe('object');
    expect(typeof result.model).toBe('string');
    expect(result.useCli).toBe(false);
  });
});

describe('createGeminiRequest — model resolution', () => {
  it('uses payload.model when present', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: false });
    expect(result.model).toBe('gemini-2.5-pro');
  });

  it('falls back to options.fallbackModel when payload.model is missing', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { fallbackModel: 'gemini-2.5-flash', useCli: false });
    expect(result.model).toBe('gemini-2.5-flash');
  });

  it('returns model: "" when both payload.model and fallback are missing', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: false });
    expect(result.model).toBe('');
  });
});

describe('createGeminiRequest — public body structure (useCli: false)', () => {
  const publicPayload = {
    model: 'gemini-2.5-pro',
    instructions: 'Use the docs.',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
    ],
    max_output_tokens: 80
  };

  it('produces body.contents array', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', publicPayload, { useCli: false });
    expect(Array.isArray(result.body.contents)).toBe(true);
    expect(result.body.contents.length).toBeGreaterThanOrEqual(1);
  });

  it('produces body.systemInstruction from instructions', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', publicPayload, { useCli: false });
    expect(result.body.systemInstruction).toBeDefined();
    expect(result.body.systemInstruction.parts).toEqual(expect.any(Array));
    expect(result.body.systemInstruction.parts.length).toBeGreaterThanOrEqual(1);
  });

  it('produces body.generationConfig with maxOutputTokens, temperature, topP, topK', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      ...publicPayload,
      temperature: 0.3,
      top_p: 0.8,
      top_k: 40,
      max_output_tokens: 80
    }, { useCli: false });
    expect(result.body.generationConfig).toBeDefined();
    expect(result.body.generationConfig.maxOutputTokens).toBe(80);
    expect(result.body.generationConfig.temperature).toBe(0.3);
    expect(result.body.generationConfig.topP).toBe(0.8);
    expect(result.body.generationConfig.topK).toBe(40);
  });

  it('produces body.generationConfig.stopSequences from stop', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      ...publicPayload,
      stop: ['DONE', 'END']
    }, { useCli: false });
    expect(result.body.generationConfig.stopSequences).toEqual(['DONE', 'END']);
  });

  it('produces body.generationConfig.thinkingConfig from reasoning_effort', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      ...publicPayload,
      reasoning_effort: 'high'
    }, { useCli: false });
    expect(result.body.generationConfig.thinkingConfig).toBeDefined();
    expect(result.body.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(result.body.generationConfig.thinkingConfig.includeThoughts).toBe(true);
  });

  it('produces body.generationConfig.candidateCount from n', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      ...publicPayload,
      n: 2
    }, { useCli: false });
    expect(result.body.generationConfig.candidateCount).toBe(2);
  });

  it('produces body.generationConfig.responseModalities from modalities', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      ...publicPayload,
      modalities: ['text', 'image']
    }, { useCli: false });
    expect(result.body.generationConfig.responseModalities).toBeDefined();
    expect(result.body.generationConfig.responseModalities).toContain('TEXT');
    expect(result.body.generationConfig.responseModalities).toContain('IMAGE');
  });

  it('produces body.generationConfig.imageConfig from image_config', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      ...publicPayload,
      image_config: { aspect_ratio: '1:1', image_size: '1024x1024' }
    }, { useCli: false });
    expect(result.body.generationConfig.imageConfig).toBeDefined();
    expect(result.body.generationConfig.imageConfig.aspectRatio).toBe('1:1');
    expect(result.body.generationConfig.imageConfig.imageSize).toBe('1024x1024');
  });
});

describe('createGeminiRequest — public tools and toolConfig', () => {
  const toolPayload = {
    model: 'gemini-2.5-pro',
    messages: [{ role: 'user', content: 'search' }],
    tools: [
      {
        type: 'function',
        function: { name: 'lookup', description: 'Find docs', parameters: { type: 'object', properties: {} } }
      },
      {
        type: 'google_search',
        web_search: { mode: 'dynamic' }
      }
    ],
    tool_choice: 'required'
  };

  it('converts function tools to functionDeclarations', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', toolPayload, { useCli: false });
    expect(Array.isArray(result.body.tools)).toBe(true);
    const funcTool = result.body.tools.find(t => t.functionDeclarations);
    expect(funcTool).toBeDefined();
    expect(funcTool.functionDeclarations[0].name).toBe('lookup');
  });

  it('preserves google_search built-in tools', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', toolPayload, { useCli: false });
    const searchTool = result.body.tools.find(t => t.googleSearch);
    expect(searchTool).toBeDefined();
    expect(searchTool.googleSearch.mode).toBe('dynamic');
  });

  it('maps tool_choice=required to toolConfig.functionCallingConfig.mode ANY', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', toolPayload, { useCli: false });
    expect(result.body.toolConfig).toBeDefined();
    expect(result.body.toolConfig.functionCallingConfig).toBeDefined();
    expect(result.body.toolConfig.functionCallingConfig.mode).toBe('ANY');
  });
});

describe('createGeminiRequest — public messages conversion', () => {
  it('maps user message content to parts', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }]
    }, { useCli: false });
    expect(result.body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'hello' }] });
  });

  it('maps assistant messages to model role', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/chat/completions', {
      messages: [{ role: 'assistant', content: 'replying' }]
    }, { useCli: false });
    expect(result.body.contents[0].role).toBe('model');
    expect(result.body.contents[0].parts[0].text).toBe('replying');
  });

  it('maps tool_calls to functionCall parts', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/chat/completions', {
      messages: [{
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          function: { name: 'lookup', arguments: '{"query":"docs"}' }
        }]
      }]
    }, { useCli: false });
    const modelMsg = result.body.contents[0];
    expect(modelMsg.role).toBe('model');
    expect(modelMsg.parts[0].functionCall).toBeDefined();
    expect(modelMsg.parts[0].functionCall.name).toBe('lookup');
    expect(modelMsg.parts[0].functionCall.args).toEqual({ query: 'docs' });
  });

  it('maps tool results to functionResponse parts', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/chat/completions', {
      messages: [{
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          function: { name: 'lookup', arguments: '{"query":"docs"}' }
        }]
      }, {
        role: 'tool',
        tool_call_id: 'call-1',
        content: JSON.stringify({ answer: 'ok' })
      }]
    }, { useCli: false });
    const userMsg = result.body.contents[1];
    expect(userMsg.role).toBe('user');
    expect(userMsg.parts[0].functionResponse.name).toBe('lookup');
    expect(userMsg.parts[0].functionResponse.response).toEqual({ answer: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// createGeminiRequest — public headers
// ---------------------------------------------------------------------------

describe('createGeminiRequest — public headers (useCli: false)', () => {
  it('sends x-goog-api-key header', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { apiKey: 'test-key', useCli: false });
    expect(result.headers['x-goog-api-key']).toBe('test-key');
  });

  it('sends Content-Type application/json', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: false });
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('sends google-genai-sdk user-agent', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: false });
    expect(result.headers['user-agent']).toBe('google-genai-sdk/0.8.0');
  });

  it('does NOT send Bearer authorization for public paths', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { apiKey: 'test-key', useCli: false });
    expect(result.headers['authorization']).toBeUndefined();
  });

  it('does NOT send Cloud Code Assist headers for public paths', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: false });
    expect(result.headers['x-goog-api-client']).toBeUndefined();
    expect(result.headers['client-metadata']).toBeUndefined();
  });
});

describe('createGeminiRequest — stream Accept for public paths', () => {
  it('sends Accept text/event-stream when streaming (useCli: false)', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { stream: true, useCli: false });
    expect(result.headers['accept']).toBe('text/event-stream');
  });

  it('sends Accept application/json when NOT streaming (useCli: false)', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { stream: false, useCli: false });
    expect(result.headers['accept']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// createGeminiRequest — /v1/responses path normalization
// ---------------------------------------------------------------------------

describe('createGeminiRequest — /v1/responses path', () => {
  it('normalizes /v1/responses payload (instructions + input) to Gemini contents', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      model: 'gemini-2.5-pro',
      instructions: 'You are a helpful assistant.',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
        { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"query":"docs"}' },
        { type: 'function_call_output', call_id: 'call-1', output: { answer: 'ok' } }
      ],
      tools: [{
        type: 'function',
        function: { name: 'lookup', description: 'Find docs', parameters: { type: 'object', properties: {} } }
      }]
    }, { useCli: false });
    expect(result.body.systemInstruction).toBeDefined();
    expect(result.body.contents.length).toBeGreaterThanOrEqual(1);
    const modelMsg = result.body.contents.find(c => c.role === 'model');
    expect(modelMsg).toBeDefined();
    expect(modelMsg.parts[0].functionCall).toBeDefined();
    const funcRespUserMsg = result.body.contents.filter(c => c.role === 'user')
      .find(c => c.parts && c.parts.some(p => p.functionResponse));
    expect(funcRespUserMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createGeminiRequest — image / media support
// ---------------------------------------------------------------------------

describe('createGeminiRequest — image and media parts', () => {
  it('converts image_url content to inlineData parts', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/chat/completions', {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }
        ]
      }]
    }, { useCli: false });
    const userParts = result.body.contents[0].parts;
    const inlineData = userParts.find(p => p.inlineData);
    expect(inlineData).toBeDefined();
    expect(inlineData.inlineData.mimeType).toBe('image/png');
  });

  it('converts file blocks to inlineData parts', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/chat/completions', {
      messages: [{
        role: 'user',
        content: [{
          type: 'file',
          file: { file_data: 'SGVsbG8=', filename: 'test.txt' }
        }]
      }]
    }, { useCli: false });
    const userParts = result.body.contents[0].parts;
    expect(userParts.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// createGeminiRequest — CLI (useCli: true)
// ---------------------------------------------------------------------------

describe('createGeminiRequest — CLI envelope (useCli: true)', () => {
  it('wraps body in { project, model, request }', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hello' }]
    }, { useCli: true });
    expect(result.body.project).toBe('');
    expect(result.body.model).toBe('gemini-2.5-pro');
    expect(result.body.request).toBeDefined();
    expect(result.body.request.contents).toBeDefined();
  });

  it('returns useCli: true', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: true });
    expect(result.useCli).toBe(true);
  });
});

describe('createGeminiRequest — CLI headers (useCli: true)', () => {
  it('sends Bearer authorization', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { apiKey: 'test-key', useCli: true });
    expect(result.headers['authorization']).toBe('Bearer test-key');
  });

  it('sends x-goog-api-key', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { apiKey: 'test-key', useCli: true });
    expect(result.headers['x-goog-api-key']).toBe('test-key');
  });

  it('sends CLI user-agent', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: true });
    expect(result.headers['user-agent']).toBe('google-api-nodejs-client/9.15.1');
  });

  it('sends x-goog-api-client header', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: true });
    expect(result.headers['x-goog-api-client']).toBe('gl-node/22.17.0');
  });

  it('sends client-metadata header', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: true });
    expect(result.headers['client-metadata']).toBe(
      'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI'
    );
  });

  it('sends Content-Type application/json', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { useCli: true });
    expect(result.headers['content-type']).toBe('application/json');
  });
});

describe('createGeminiRequest — CLI stream Accept', () => {
  it('sends Accept text/event-stream when streaming (useCli: true)', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { stream: true, useCli: true });
    expect(result.headers['accept']).toBe('text/event-stream');
  });

  it('sends Accept application/json when NOT streaming (useCli: true)', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { stream: false, useCli: true });
    expect(result.headers['accept']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// createGeminiRequest — networkHeaders: false
// ---------------------------------------------------------------------------

describe('createGeminiRequest — networkHeaders false', () => {
  it('skips auth/CLI headers when networkHeaders is false', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, { apiKey: 'test-key', networkHeaders: false, useCli: false });
    expect(result.body).toHaveProperty('contents');
    expect(result.headers['x-goog-api-key']).toBeUndefined();
    expect(result.headers['authorization']).toBeUndefined();
  });

  it('still normalizes body when networkHeaders is false', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hello' }],
      reasoning_effort: 'high',
      max_output_tokens: 100,
      tools: [{
        type: 'function',
        function: { name: 'lookup', parameters: { type: 'object', properties: {} } }
      }]
    }, { networkHeaders: false, useCli: false });
    expect(result.body.contents).toBeDefined();
    expect(result.body.generationConfig).toBeDefined();
    expect(result.body.tools).toBeDefined();
    expect(result.body.generationConfig.thinkingConfig).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// buildGeminiTargetUrl — public (native) URLs
// ---------------------------------------------------------------------------

describe('buildGeminiTargetUrl — public/native (useCli: false)', () => {
  it('builds generateContent URL with model in path', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://generativelanguage.googleapis.com',
      'gemini-2.5-pro', 'test-key', { useCli: false }
    );
    expect(url).toContain('/v1beta/models/gemini-2.5-pro:generateContent');
  });

  it('includes key query parameter', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://generativelanguage.googleapis.com',
      'gemini-2.5-pro', 'test-key', { useCli: false }
    );
    expect(new URL(url).searchParams.get('key')).toBe('test-key');
  });

  it('builds streamGenerateContent with alt=sse when streaming', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://generativelanguage.googleapis.com',
      'gemini-2.5-pro', 'test-key', { useCli: false, stream: true }
    );
    expect(url).toContain(':streamGenerateContent');
    expect(new URL(url).searchParams.get('alt')).toBe('sse');
  });

  it('preserves existing base path segments', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://generativelanguage.googleapis.com/v1beta',
      'gemini-2.5-pro', 'test-key', { useCli: false }
    );
    expect(url).toContain('/v1beta/models/gemini-2.5-pro:generateContent');
  });

  it('strips existing /models path to avoid duplication', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://generativelanguage.googleapis.com/v1beta/models/old-model:generateContent',
      'gemini-2.5-pro', 'test-key', { useCli: false }
    );
    expect(url).toContain('/v1beta/models/gemini-2.5-pro:generateContent');
    expect((url.match(/\/models\//g) || []).length).toBe(1);
  });

  it('works with custom base URLs', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://custom-proxy.example.com/api',
      'gemini-2.5-pro', 'test-key', { useCli: false }
    );
    expect(url).toContain('/api/v1beta/models/gemini-2.5-pro:generateContent');
  });

  it('preserves existing query parameters', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://generativelanguage.googleapis.com?region=us',
      'gemini-2.5-pro', 'test-key', { useCli: false }
    );
    expect(new URL(url).searchParams.get('region')).toBe('us');
  });
});

// ---------------------------------------------------------------------------
// buildGeminiTargetUrl — CLI URLs (useCli: true)
// ---------------------------------------------------------------------------

describe('buildGeminiTargetUrl — CLI (useCli: true)', () => {
  it('builds v1internal:generateContent for non-streaming', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://cloudcode-pa.googleapis.com',
      'gemini-2.5-pro', 'test-key', { useCli: true }
    );
    expect(url).toContain('/v1internal:generateContent');
  });

  it('builds v1internal:streamGenerateContent?alt=sse for streaming', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://cloudcode-pa.googleapis.com',
      'gemini-2.5-pro', 'test-key', { useCli: true, stream: true }
    );
    expect(url).toContain('/v1internal:streamGenerateContent');
    expect(new URL(url).searchParams.get('alt')).toBe('sse');
  });

  it('preserves existing /v1internal path', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://cloudcode-pa.googleapis.com/v1internal',
      'gemini-2.5-pro', 'test-key', { useCli: true }
    );
    expect(url).toContain('/v1internal:generateContent');
    expect((url.match(/\/v1internal/g) || []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildGeminiTargetUrl — native/Vertex stays public
// ---------------------------------------------------------------------------

describe('buildGeminiTargetUrl — native/Vertex stays public', () => {
  it('generativelanguage.googleapis.com stays public with useCli: false', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://generativelanguage.googleapis.com',
      'gemini-2.5-pro', 'test-key', { useCli: false }
    );
    expect(url).toContain('/v1beta/models/');
    expect(url).not.toContain('/v1internal');
  });

  it('Vertex AI style URL stays public with useCli: false', () => {
    
    const url = geminiWire.buildGeminiTargetUrl(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/t/locations/us-central1/publishers/google/models',
      'gemini-2.5-pro', 'test-key', { useCli: false }
    );
    expect(url).toContain('/models/gemini-2.5-pro:generateContent');
  });
});

// ---------------------------------------------------------------------------
// shouldUseGeminiCliFormat
// ---------------------------------------------------------------------------

describe('shouldUseGeminiCliFormat', () => {
  it('returns true for /v1internal paths', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat('https://cloudcode-pa.googleapis.com/v1internal')).toBe(true);
  });

  it('returns true for :generateContent paths', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat('https://custom.example.com/v1internal:generateContent')).toBe(true);
  });

  it('returns true for :streamGenerateContent paths', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat('https://custom.example.com/v1internal:streamGenerateContent')).toBe(true);
  });

  it('returns true for cloudcode-pa.googleapis.com host', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat('https://cloudcode-pa.googleapis.com')).toBe(true);
  });

  it('returns false for /v1beta paths', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat('https://generativelanguage.googleapis.com/v1beta')).toBe(false);
  });

  it('returns false for /models/ paths', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
    )).toBe(false);
  });

  it('returns false for generativelanguage.googleapis.com bare host', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat('https://generativelanguage.googleapis.com')).toBe(false);
  });

  it('returns false for invalid URL', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat('not-a-url')).toBe(false);
  });

  it('returns false for empty string', () => {
    
    expect(geminiWire.shouldUseGeminiCliFormat('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DEFECT 1: Malformed non-empty URLs return ''
// ---------------------------------------------------------------------------

describe('buildGeminiTargetUrl — malformed URLs', () => {
  it('returns empty string for non-empty malformed native URL', () => {
    
    expect(geminiWire.buildGeminiTargetUrl('not-a-url:::', 'gemini-2.5-pro', 'key', { useCli: false })).toBe('');
  });

  it('returns empty string for non-empty malformed CLI URL', () => {
    
    expect(geminiWire.buildGeminiTargetUrl('not-a-url:::', 'gemini-2.5-pro', 'key', { useCli: true })).toBe('');
  });

  it('returns valid URL for empty base (defaults to generative language)', () => {
    
    const url = geminiWire.buildGeminiTargetUrl('', 'gemini-2.5-pro', 'test-key', { useCli: false });
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('/models/gemini-2.5-pro:generateContent');
  });

  it('returns valid CLI URL for empty base (defaults to cloudcode-pa)', () => {
    
    const url = geminiWire.buildGeminiTargetUrl('', 'gemini-2.5-pro', 'test-key', { useCli: true });
    expect(url).toContain('/v1internal:generateContent');
  });
});

// ---------------------------------------------------------------------------
// DEFECT 2: Case-insensitive header override with opposite credential suppression
// ---------------------------------------------------------------------------

describe('createGeminiRequest — header overrides', () => {
  it('merges explicit Authorization from options.headers on CLI path (case-insensitive)', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'test-key',
      useCli: true,
      headers: { 'Authorization': 'Bearer override-cli' }
    });
    expect(result.headers['authorization']).toBe('Bearer override-cli');
    expect(result.headers['x-goog-api-key']).toBeUndefined();
  });

  it('merges explicit x-goog-api-key from options.providerConfig.headers on public path', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'original-key',
      useCli: false,
      providerConfig: { headers: { 'x-goog-api-key': 'override-api-key' } }
    });
    expect(result.headers['x-goog-api-key']).toBe('override-api-key');
    expect(result.headers['authorization']).toBeUndefined();
  });

  it('suppresses generated opposite credential when explicit Authorization set on CLI (case-insensitive)', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      apiKey: 'test-key',
      useCli: true,
      headers: { 'AUTHORIZATION': 'Bearer MIXED' }
    });
    expect(result.headers['authorization']).toBe('Bearer MIXED');
    expect(result.headers['x-goog-api-key']).toBeUndefined();
  });

  it('allows overriding non-credential fixed headers', () => {
    
    const result = geminiWire.createGeminiRequest('/v1/responses', {
      messages: [{ role: 'user', content: 'hi' }]
    }, {
      useCli: false,
      headers: { 'user-agent': 'custom-agent/1.0' }
    });
    expect(result.headers['user-agent']).toBe('custom-agent/1.0');
  });
});
