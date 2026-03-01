const assert = require('assert');

const {
  convertOpenCodePayloadToClaude,
  convertOpenCodePayloadToCodexResponses,
  convertOpenCodePayloadToGemini,
  stripClaudeToolNamePrefix
} = require('../src/server/services/opencode-gateway-adapters');

function testClaudeAdapter() {
  const payload = {
    model: 'claude-sonnet-4-20250514',
    tool_choice: { type: 'function', function: { name: 'lookup' } },
    tools: [
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'OpenCode tool for OpenCode projects',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      }
    ],
    input: [
      {
        type: 'message',
        role: 'system',
        content: [{ type: 'text', text: 'You are OpenCode assistant.' }]
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'text', text: 'please keep OpenCode wording in user content' }]
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'lookup', input: { q: 'hello' } }]
      }
    ]
  };

  const out = convertOpenCodePayloadToClaude('/v1/responses', payload, '');

  assert(Array.isArray(out.system) && out.system.length > 0, 'Claude system blocks should exist');
  assert(/Claude Code/.test(out.system[0].text), 'System identity text should be rewritten to Claude Code');
  assert(!/OpenCode/.test(out.system[0].text), 'System identity text should not keep OpenCode');

  const userBlock = out.messages.find(msg => msg.role === 'user')?.content?.[0];
  assert(userBlock && userBlock.text.includes('OpenCode wording'), 'User content must be preserved');

  assert(out.tools[0].name === 'mcp_lookup', 'Claude tool definition should have mcp_ prefix');
  assert(/Claude Code/.test(out.tools[0].description), 'Tool description identity text should be rewritten');
  assert(out.tool_choice?.name === 'mcp_lookup', 'Claude tool_choice should have mcp_ prefix');

  const toolUseName = out.messages.find(msg => msg.role === 'assistant')?.content?.find(c => c.type === 'tool_use')?.name;
  assert(toolUseName === 'mcp_lookup', 'Claude tool_use block should have mcp_ prefix');

  assert(out.metadata && typeof out.metadata.user_id === 'string' && out.metadata.user_id.trim(), 'Claude metadata.user_id must exist');
  assert(/^user_[0]{64}_account__session_/.test(out.metadata.user_id), 'Claude metadata.user_id should use relay-compatible format');

  assert.strictEqual(stripClaudeToolNamePrefix('mcp_lookup'), 'lookup', 'strip helper should remove mcp_ prefix');
  assert.strictEqual(stripClaudeToolNamePrefix('lookup'), 'lookup', 'strip helper should preserve non-prefixed names');
}

function testClaudeAdapterInjectsIdentitySystemPrompt() {
  const payload = {
    model: 'claude-sonnet-4-20250514',
    messages: [
      { role: 'user', content: 'hello' }
    ]
  };

  const out = convertOpenCodePayloadToClaude('/v1/chat/completions', payload, '');
  const systemText = out.system?.[0]?.text || '';
  assert(systemText.includes("Claude Code"), 'Claude identity system prompt should be injected when absent');
  assert(
    /_account__session_session_test$/.test(out.metadata?.user_id || ''),
    'Claude metadata.user_id should use deterministic fallback session seed when none provided'
  );
}

function testClaudeAdapterSanitizesInvalidMetadataUserId() {
  const sessionUserId = 'user_0000000000000000000000000000000000000000000000000000000000000000_account__session_session_test';
  const payload = {
    model: 'claude-sonnet-4-20250514',
    metadata: {
      user_id: '[undefined]'
    },
    messages: [
      { role: 'user', content: 'hello' }
    ]
  };

  const out = convertOpenCodePayloadToClaude('/v1/chat/completions', payload, '', { sessionUserId });
  assert.strictEqual(out.metadata?.user_id, sessionUserId, 'Invalid metadata.user_id should fallback to session user id');
}

function testCodexAdapter() {
  const payload = {
    input: [
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'sys text' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
    ],
    include: ['foo'],
    max_output_tokens: 123,
    temperature: 0.2,
    prompt_cache_retention: 'aggressive'
  };

  const out = convertOpenCodePayloadToCodexResponses(payload, 'gpt-5-codex');

  assert.strictEqual(out.model, 'gpt-5-codex', 'Codex fallback model should be applied');
  assert.strictEqual(out.requestBody.stream, true, 'Codex stream should be enabled');
  assert.strictEqual(out.requestBody.store, false, 'Codex store should be disabled');
  assert(Array.isArray(out.requestBody.include), 'Codex include should be array');
  assert(out.requestBody.include.includes('reasoning.encrypted_content'), 'Codex include should contain reasoning.encrypted_content');

  const firstRole = out.requestBody.input?.[0]?.role;
  assert.strictEqual(firstRole, 'developer', 'Codex system role should be rewritten to developer');

  assert.strictEqual(out.requestBody.max_output_tokens, undefined, 'Codex max_output_tokens should be removed');
  assert.strictEqual(out.requestBody.temperature, undefined, 'Codex temperature should be removed');
  assert.strictEqual(out.requestBody.prompt_cache_retention, undefined, 'Codex prompt_cache_retention should be removed');
}

function testGeminiAdapter() {
  const payload = {
    model: 'gemini-2.5-pro',
    tools: [
      {
        type: 'function',
        function: {
          name: 'lookup',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      }
    ],
    input: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'lookup', input: { q: 'hello' } }]
      }
    ]
  };

  const out = convertOpenCodePayloadToGemini('/v1/responses', payload, '');

  const fnDeclName = out.requestBody.tools?.[0]?.functionDeclarations?.[0]?.name;
  const fnCallName = out.requestBody.contents?.[0]?.parts?.[0]?.functionCall?.name;

  assert.strictEqual(fnDeclName, 'lookup', 'Gemini function declaration name should not be prefixed');
  assert.strictEqual(fnCallName, 'lookup', 'Gemini function call name should not be prefixed');
}

function run() {
  testClaudeAdapter();
  testClaudeAdapterInjectsIdentitySystemPrompt();
  testClaudeAdapterSanitizesInvalidMetadataUserId();
  testCodexAdapter();
  testGeminiAdapter();
  console.log('OpenCode gateway adapters regression tests passed');
}

run();
