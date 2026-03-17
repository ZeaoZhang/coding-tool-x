const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  readJSONL,
  extractSessionMeta,
  extractMessages,
  extractTokenUsage,
  parseSession,
  parseSessionMeta
} = require('../../../src/server/services/codex-parser');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionMeta(overrides = {}) {
  return {
    type: 'session_meta',
    payload: {
      id: 'sess-001',
      timestamp: '2024-01-01T00:00:00Z',
      cwd: '/home/user/project',
      cli_version: '1.0.0',
      model_provider: 'openai',
      git: null,
      ...overrides
    }
  };
}

function makeUserMessage(text, timestamp = '2024-01-01T00:01:00Z') {
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'message',
      role: 'user',
      content: [{ text }]
    }
  };
}

function makeAssistantMessage(text, model = null, timestamp = '2024-01-01T00:02:00Z') {
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'message',
      role: 'assistant',
      model,
      content: [{ text }]
    }
  };
}

function makeFunctionCall(name, args, callId = 'call-1', model = null, timestamp = '2024-01-01T00:03:00Z') {
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'function_call',
      name,
      arguments: args,
      call_id: callId,
      model
    }
  };
}

function makeFunctionCallOutput(output, callId = 'call-1', timestamp = '2024-01-01T00:04:00Z') {
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'function_call_output',
      call_id: callId,
      output
    }
  };
}

function makeReasoning(summaryTexts, timestamp = '2024-01-01T00:05:00Z') {
  return {
    type: 'response_item',
    timestamp,
    payload: {
      type: 'reasoning',
      summary: summaryTexts.map(t => ({ text: t }))
    }
  };
}

function makeTurnContext(model) {
  return {
    type: 'turn_context',
    payload: { model }
  };
}

function makeTokenEvent(usage) {
  return {
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: usage.input || 0,
          output_tokens: usage.output || 0,
          cached_input_tokens: usage.cacheRead || 0,
          cache_creation_input_tokens: usage.cacheCreation || 0,
          reasoning_output_tokens: usage.reasoning || 0,
          total_tokens: usage.total || 0
        }
      }
    }
  };
}

function toJSONL(objects) {
  return objects.map(o => JSON.stringify(o)).join('\n');
}

// ---------------------------------------------------------------------------
// fs-dependent test setup
// ---------------------------------------------------------------------------

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// extractSessionMeta
// ---------------------------------------------------------------------------

describe('extractSessionMeta', () => {
  test('returns correct object from valid session_meta line', () => {
    const lines = [makeSessionMeta()];
    const result = extractSessionMeta(lines);

    expect(result).toEqual({
      sessionId: 'sess-001',
      timestamp: '2024-01-01T00:00:00Z',
      cwd: '/home/user/project',
      cliVersion: '1.0.0',
      provider: 'openai',
      git: null
    });
  });

  test('includes git object when git info is present', () => {
    const lines = [
      makeSessionMeta({
        git: {
          branch: 'main',
          commit_hash: 'abc123',
          repository_url: 'https://github.com/user/repo'
        }
      })
    ];
    const result = extractSessionMeta(lines);

    expect(result.git).toEqual({
      branch: 'main',
      commitHash: 'abc123',
      repositoryUrl: 'https://github.com/user/repo'
    });
  });

  test('git is null when git field is absent', () => {
    const lines = [makeSessionMeta({ git: undefined })];
    const result = extractSessionMeta(lines);
    expect(result.git).toBeNull();
  });

  test('returns null when no session_meta line present', () => {
    const lines = [makeUserMessage('hello')];
    expect(extractSessionMeta(lines)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(extractSessionMeta([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractMessages
// ---------------------------------------------------------------------------

describe('extractMessages', () => {
  test('user message produces correct shape', () => {
    const lines = [makeUserMessage('hello world', '2024-01-01T00:01:00Z')];
    const msgs = extractMessages(lines);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: 'user',
      content: 'hello world',
      timestamp: '2024-01-01T00:01:00Z',
      model: null
    });
  });

  test('assistant message produces correct shape', () => {
    const lines = [makeAssistantMessage('hi there', 'gpt-4o', '2024-01-01T00:02:00Z')];
    const msgs = extractMessages(lines);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: 'assistant',
      content: 'hi there',
      model: 'gpt-4o',
      timestamp: '2024-01-01T00:02:00Z'
    });
  });

  test('function_call with JSON arguments gets parsed', () => {
    const args = JSON.stringify({ query: 'test', limit: 5 });
    const lines = [makeFunctionCall('search', args, 'call-42')];
    const msgs = extractMessages(lines);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: 'tool_call',
      name: 'search',
      callId: 'call-42',
      arguments: { query: 'test', limit: 5 }
    });
  });

  test('function_call with non-JSON arguments keeps value as-is', () => {
    const lines = [makeFunctionCall('run', 'not-json', 'call-99')];
    const msgs = extractMessages(lines);

    expect(msgs[0].arguments).toBe('not-json');
  });

  test('function_call_output with JSON output gets parsed', () => {
    const output = JSON.stringify({ status: 'ok', count: 3 });
    const lines = [makeFunctionCallOutput(output, 'call-1')];
    const msgs = extractMessages(lines);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: 'tool_output',
      callId: 'call-1',
      output: { status: 'ok', count: 3 }
    });
  });

  test('function_call_output with plain text keeps value as-is', () => {
    const lines = [makeFunctionCallOutput('Exit code: 0', 'call-1')];
    const msgs = extractMessages(lines);

    expect(msgs[0].output).toBe('Exit code: 0');
  });

  test('reasoning with summary produces reasoning role message', () => {
    const lines = [makeReasoning(['first thought', 'second thought'])];
    const msgs = extractMessages(lines);

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: 'reasoning',
      content: 'first thought\nsecond thought'
    });
  });

  test('model from turn_context propagates to next response_item', () => {
    const lines = [
      makeTurnContext('gpt-4o-mini'),
      makeAssistantMessage('hello', null)
    ];
    const msgs = extractMessages(lines);

    expect(msgs[0].model).toBe('gpt-4o-mini');
  });

  test('model from payload.model takes precedence over turn_context', () => {
    const lines = [
      makeTurnContext('gpt-4o-mini'),
      makeAssistantMessage('hello', 'o1-preview')
    ];
    const msgs = extractMessages(lines);

    expect(msgs[0].model).toBe('o1-preview');
  });

  test('lastAssistantModel carries forward to subsequent messages', () => {
    const lines = [
      makeAssistantMessage('first', 'gpt-4o'),
      makeFunctionCall('tool', '{}', 'call-1', null)
    ];
    const msgs = extractMessages(lines);

    // The function_call after assistant message should carry forward gpt-4o
    const toolCall = msgs.find(m => m.role === 'tool_call');
    expect(toolCall.model).toBe('gpt-4o');
  });

  test('empty content text is skipped for message type', () => {
    const line = {
      type: 'response_item',
      timestamp: '2024-01-01T00:01:00Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ text: '   ' }]
      }
    };
    const msgs = extractMessages([line]);
    expect(msgs).toHaveLength(0);
  });

  test('mixed sequence produces correct ordered messages', () => {
    const lines = [
      makeUserMessage('what is 2+2'),
      makeTurnContext('gpt-4o'),
      makeReasoning(['math reasoning']),
      makeAssistantMessage('4', null),
      makeFunctionCall('calculator', '{"expr":"2+2"}', 'c1'),
      makeFunctionCallOutput('4', 'c1')
    ];
    const msgs = extractMessages(lines);

    expect(msgs).toHaveLength(5);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('reasoning');
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[3].role).toBe('tool_call');
    expect(msgs[4].role).toBe('tool_output');
  });
});

// ---------------------------------------------------------------------------
// extractTokenUsage
// ---------------------------------------------------------------------------

describe('extractTokenUsage', () => {
  test('valid token event returns correct usage object', () => {
    const lines = [
      makeTokenEvent({ input: 100, output: 50, cacheRead: 20, cacheCreation: 5, reasoning: 10, total: 185 })
    ];
    const result = extractTokenUsage(lines);

    expect(result).toEqual({
      input: 100,
      output: 50,
      cacheRead: 20,
      cacheCreation: 5,
      reasoning: 10,
      total: 185
    });
  });

  test('multiple events returns the last one', () => {
    const lines = [
      makeTokenEvent({ input: 10, output: 5, total: 15 }),
      makeTokenEvent({ input: 200, output: 100, total: 300 })
    ];
    const result = extractTokenUsage(lines);

    expect(result.total).toBe(300);
    expect(result.input).toBe(200);
  });

  test('no token events returns null', () => {
    const lines = [makeUserMessage('hello'), makeAssistantMessage('hi')];
    expect(extractTokenUsage(lines)).toBeNull();
  });

  test('event_msg without total_token_usage returns null', () => {
    const line = {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {}
      }
    };
    expect(extractTokenUsage([line])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readJSONL
// ---------------------------------------------------------------------------

describe('readJSONL', () => {
  test('reads valid JSONL file and returns parsed objects', () => {
    const filePath = path.join(testDir, 'valid.jsonl');
    const objects = [{ a: 1 }, { b: 'two' }, { c: true }];
    fs.writeFileSync(filePath, toJSONL(objects));

    const result = readJSONL(filePath);
    expect(result).toEqual(objects);
  });

  test('non-existent file returns empty array', () => {
    const result = readJSONL(path.join(testDir, 'no-such-file.jsonl'));
    expect(result).toEqual([]);
  });

  test('mixed valid and invalid lines skips invalid ones', () => {
    const filePath = path.join(testDir, 'mixed.jsonl');
    fs.writeFileSync(filePath, '{"a":1}\nnot-json\n{"b":2}\n{bad}\n{"c":3}');

    const result = readJSONL(filePath);
    expect(result).toHaveLength(3);
    expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  test('empty file returns empty array', () => {
    const filePath = path.join(testDir, 'empty.jsonl');
    fs.writeFileSync(filePath, '');

    const result = readJSONL(filePath);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseSessionMeta
// ---------------------------------------------------------------------------

describe('parseSessionMeta', () => {
  test('full session file returns meta, tokens and preview', () => {
    const filePath = path.join(testDir, 'session.jsonl');
    const objects = [
      makeSessionMeta(),
      makeUserMessage('what is the meaning of life'),
      makeTokenEvent({ input: 50, output: 25, total: 75 })
    ];
    fs.writeFileSync(filePath, toJSONL(objects));

    const result = parseSessionMeta(filePath);

    expect(result).not.toBeNull();
    expect(result.meta.sessionId).toBe('sess-001');
    expect(result.preview).toBe('what is the meaning of life');
    expect(result.tokens.total).toBe(75);
    expect(result.filePath).toBe(filePath);
  });

  test('skips Warmup user messages for preview', () => {
    const filePath = path.join(testDir, 'warmup.jsonl');
    const objects = [
      makeSessionMeta(),
      makeUserMessage('Warmup'),
      makeUserMessage('real question here')
    ];
    fs.writeFileSync(filePath, toJSONL(objects));

    const result = parseSessionMeta(filePath);
    expect(result.preview).toBe('real question here');
  });

  test('skips environment_context user messages for preview', () => {
    const filePath = path.join(testDir, 'env-ctx.jsonl');
    const objects = [
      makeSessionMeta(),
      makeUserMessage('<environment_context>some env data</environment_context>'),
      makeUserMessage('actual user question')
    ];
    fs.writeFileSync(filePath, toJSONL(objects));

    const result = parseSessionMeta(filePath);
    expect(result.preview).toBe('actual user question');
  });

  test('no meta line returns null', () => {
    const filePath = path.join(testDir, 'no-meta.jsonl');
    const objects = [makeUserMessage('hello'), makeAssistantMessage('hi')];
    fs.writeFileSync(filePath, toJSONL(objects));

    expect(parseSessionMeta(filePath)).toBeNull();
  });

  test('message count reflects number of response_item lines', () => {
    const filePath = path.join(testDir, 'count.jsonl');
    const objects = [
      makeSessionMeta(),
      makeUserMessage('msg1'),
      makeAssistantMessage('reply1'),
      makeUserMessage('msg2'),
      makeFunctionCall('tool', '{}', 'c1')
    ];
    fs.writeFileSync(filePath, toJSONL(objects));

    const result = parseSessionMeta(filePath);
    // 4 response_item lines (user, assistant, user, function_call)
    expect(result.messageCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// parseSession
// ---------------------------------------------------------------------------

describe('parseSession', () => {
  test('full session returns meta, messages and tokens', () => {
    const filePath = path.join(testDir, 'full.jsonl');
    const objects = [
      makeSessionMeta(),
      makeUserMessage('hello'),
      makeAssistantMessage('world', 'gpt-4o'),
      makeTokenEvent({ input: 10, output: 5, total: 15 })
    ];
    fs.writeFileSync(filePath, toJSONL(objects));

    const result = parseSession(filePath);

    expect(result).not.toBeNull();
    expect(result.meta.sessionId).toBe('sess-001');
    expect(result.messages).toHaveLength(2);
    expect(result.tokens.total).toBe(15);
    expect(result.filePath).toBe(filePath);
  });

  test('empty file returns null', () => {
    const filePath = path.join(testDir, 'empty.jsonl');
    fs.writeFileSync(filePath, '');

    expect(parseSession(filePath)).toBeNull();
  });

  test('file with no session_meta returns null', () => {
    const filePath = path.join(testDir, 'no-meta.jsonl');
    const objects = [makeUserMessage('hello'), makeAssistantMessage('hi')];
    fs.writeFileSync(filePath, toJSONL(objects));

    expect(parseSession(filePath)).toBeNull();
  });
});
