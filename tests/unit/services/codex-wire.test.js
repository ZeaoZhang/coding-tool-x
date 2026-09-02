'use strict';

const { createCodexRequest, normalizeCodexResponsesInput, buildCodexTargetUrl } = require('../../../src/platforms/drivers/codex/wire');

describe('Codex wire compatibility', () => {
  it('builds the current official-client request identity and Codex-safe body', () => {
    const result = createCodexRequest({
      model: 'gpt-5.5',
      input: [
        {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: 'system guidance' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }]
        }
      ],
      include: ['foo'],
      temperature: 0.2,
      top_p: 0.9,
      top_k: 10,
      min_p: 0.1,
      presence_penalty: 0.2,
      frequency_penalty: 0.3,
      repetition_penalty: 1.1,
      stop: ['END'],
      max_output_tokens: 123,
      max_completion_tokens: 456,
      service_tier: 'default',
      prompt_cache_retention: '24h'
    }, {
      apiKey: 'secret-key',
      sessionId: 'session-test',
      threadId: 'thread-test',
      windowId: 'window-test',
      turnId: 'turn-test',
      installationId: 'installation-test',
      userAgent: 'codex_exec/0.144.1 (test)',
      originator: 'codex_exec'
    });

    expect(result.model).toBe('gpt-5.5');
    expect(result.targetUrl).toBeUndefined();
    expect(result.headers.authorization).toBe('Bearer secret-key');
    expect(result.headers.originator).toBe('codex_exec');
    expect(result.headers['user-agent']).toBe('codex_exec/0.144.1 (test)');
    expect(result.headers['session-id']).toBe('session-test');
    expect(result.headers['thread-id']).toBe('thread-test');
    expect(result.headers['x-codex-window-id']).toBe('window-test');
    expect(result.headers['x-client-request-id']).toBe('session-test');
    expect(result.headers['x-codex-beta-features']).toBe('remote_compaction_v2');

    expect(result.body.stream).toBe(true);
    expect(result.body.store).toBe(false);
    expect(result.body.prompt_cache_key).toBe('session-test');
    expect(result.body.include).toEqual(['foo', 'reasoning.encrypted_content']);
    expect(result.body.input[0].role).toBe('developer');
    expect(result.body.input[1].role).toBe('user');
    expect(result.body.temperature).toBeUndefined();
    expect(result.body.top_p).toBeUndefined();
    expect(result.body.top_k).toBeUndefined();
    expect(result.body.min_p).toBeUndefined();
    expect(result.body.presence_penalty).toBeUndefined();
    expect(result.body.frequency_penalty).toBeUndefined();
    expect(result.body.repetition_penalty).toBeUndefined();
    expect(result.body.stop).toBeUndefined();
    expect(result.body.max_output_tokens).toBeUndefined();
    expect(result.body.max_completion_tokens).toBeUndefined();
    expect(result.body.service_tier).toBeUndefined();
    expect(result.body.prompt_cache_retention).toBeUndefined();

    const turnMetadata = JSON.parse(result.headers['x-codex-turn-metadata']);
    expect(turnMetadata).toEqual(expect.objectContaining({
      installation_id: 'installation-test',
      session_id: 'session-test',
      thread_id: 'thread-test',
      turn_id: 'turn-test',
      window_id: 'window-test',
      request_kind: 'turn'
    }));
    expect(result.body.client_metadata).toEqual(expect.objectContaining({
      'x-codex-installation-id': 'installation-test',
      session_id: 'session-test',
      thread_id: 'thread-test',
      'x-codex-window-id': 'window-test',
      turn_id: 'turn-test',
      'x-codex-turn-metadata': result.headers['x-codex-turn-metadata']
    }));
  });

  it('normalizes string input and maps system messages to developer messages', () => {
    expect(normalizeCodexResponsesInput('hello')).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }]
      }
    ]);
    expect(normalizeCodexResponsesInput([
      { type: 'message', role: 'system', content: 'rules' },
      { type: 'message', role: 'assistant', content: 'answer' }
    ])).toEqual([
      { type: 'message', role: 'developer', content: 'rules' },
      { type: 'message', role: 'assistant', content: 'answer' }
    ]);
  });

  it('builds a Responses endpoint from a provider base URL without duplicating paths', () => {
    expect(buildCodexTargetUrl('https://api.example/v1')).toBe('https://api.example/v1/responses');
    expect(buildCodexTargetUrl('https://api.example/v1/responses')).toBe('https://api.example/v1/responses');
    expect(buildCodexTargetUrl('https://api.example/backend-api/codex')).toBe('https://api.example/backend-api/codex/responses');
  });
});
