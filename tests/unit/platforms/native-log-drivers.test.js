'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const claudeDriver = require('../../../src/platforms/drivers/claude/native-logs');
const codexDriver = require('../../../src/platforms/drivers/codex/native-logs');
const geminiDriver = require('../../../src/platforms/drivers/gemini/native-logs');
const opencodeDriver = require('../../../src/platforms/drivers/opencode/native-logs');
const {
  createScannedFileCursor,
  createSelectiveJsonLineParser,
  visitJsonLinesForward,
  visitJsonLinesReverse
} = require('../../../src/platforms/drivers/native-log-utils');

let testDir;

function writeJsonLines(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map(record => JSON.stringify(record)).join('\n') + '\n');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-log-drivers-'));
});

afterEach(() => {
  delete process.env.OPENCODE_DB_PATH;
  fs.rmSync(testDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('file-backed native log cursors', () => {
  test('Gemini retains only scalar usage metadata across repeated updates', () => {
    const state = { metadata: {}, entryIndex: 0 };
    for (let index = 0; index < 100; index += 1) {
      geminiDriver.parseGeminiJsonlLine('session-test.jsonl', {
        $set: { sessionId: 'session', model: 'gemini-test', provider: 'google', lastUpdated: index, [`history-${index}`]: { content: 'x'.repeat(1024) } }
      }, state);
    }
    expect(state.metadata).toEqual({ sessionId: 'session', model: 'gemini-test', provider: 'google', lastUpdated: 99 });
    geminiDriver.parseGeminiJsonlLine('session-test.jsonl', { $set: { model: { content: 'invalid' }, provider: null } }, state);
    expect(state.metadata.model).toBe('gemini-test');
    expect(state.metadata.provider).toBe('');
  });

  test('can establish a file baseline without parsing historical content', () => {
    const filePath = path.join(testDir, 'claude', 'session.jsonl');
    writeJsonLines(filePath, [{ id: 'old', tokens: { input: 1 } }]);
    let parseCount = 0;
    const cursor = createScannedFileCursor({
      scanFiles: () => [filePath],
      parseFile: () => {
        parseCount += 1;
        return [{ id: 'new', tokens: { input: 1, total: 1 } }];
      },
      normalizeEvent: event => event,
      skipInitialParse: true
    });

    cursor.initialize();
    expect(parseCount).toBe(0);
    expect(cursor.readNewEvents()).toEqual([]);

    fs.appendFileSync(filePath, JSON.stringify({ id: 'appended' }) + '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({ id: 'new' })]);
    expect(parseCount).toBe(1);
  });

  test('Claude emits each assistant usage record once and handles partial JSONL writes', () => {
    const filePath = path.join(testDir, 'claude', 'session.jsonl');
    writeJsonLines(filePath, [{
      type: 'assistant',
      uuid: 'assistant-1',
      timestamp: '2026-09-14T00:00:00.000Z',
      message: { role: 'assistant', model: 'claude-sonnet', usage: { input_tokens: 10, output_tokens: 4 } }
    }]);

    const cursor = claudeDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();
    expect(cursor.readNewEvents()).toEqual([]);

    fs.appendFileSync(filePath, '{"type":"assistant","uuid":"assistant-2","message":{"role":"assistant","usage":{"input_tokens":20');
    expect(cursor.readNewEvents()).toEqual([]);

    fs.appendFileSync(filePath, ',"output_tokens":5}}}\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      id: 'session.jsonl:assistant-2',
      tokens: expect.objectContaining({ input: 20, output: 5, total: 25 })
    })]);
    expect(cursor.readNewEvents()).toEqual([]);
  });

  test('JSONL bursts stop at exact byte boundaries and drain without skipping events', () => {
    const filePath = path.join(testDir, 'claude', 'burst.jsonl');
    writeJsonLines(filePath, []);
    const cursor = claudeDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    try {
      cursor.initialize();
      const records = Array.from({ length: 1200 }, (_, i) => ({ type: 'assistant', uuid: `burst-${i}`, message: { role: 'assistant', usage: { input_tokens: 1 } } }));
      fs.appendFileSync(filePath, records.map(record => JSON.stringify(record)).join('\n') + '\n');
      const batches = [cursor.readNewEvents(), cursor.readNewEvents(), cursor.readNewEvents()];
      expect(batches.map(batch => batch.length)).toEqual([500, 500, 200]);
      expect(batches.flat().map(event => event.id)).toEqual(records.map(record => `burst.jsonl:${record.uuid}`));
      expect(cursor.readNewEvents()).toEqual([]);
    } finally { cursor.close(); }
  });

  test('a truncated or replaced Claude file is treated as a new cursor source', () => {
    const filePath = path.join(testDir, 'claude', 'session.jsonl');
    writeJsonLines(filePath, [{ type: 'assistant', uuid: 'old', message: { role: 'assistant', usage: { input_tokens: 1 } } }]);
    const cursor = claudeDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();

    fs.writeFileSync(filePath, JSON.stringify({ type: 'assistant', uuid: 'new', message: { role: 'assistant', usage: { input_tokens: 2 } } }) + '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({ id: 'session.jsonl:new' })]);
  });

  test('Codex converts cumulative token_count snapshots into non-negative deltas', () => {
    const filePath = path.join(testDir, 'codex', 'rollout-1.jsonl');
    const makeRecords = total => [
      { type: 'session_meta', payload: { id: 'session-1', model_provider: 'openai' } },
      { type: 'turn_context', payload: { model: 'gpt-5' } },
      { type: 'event_msg', timestamp: '2026-09-14T00:00:00.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: 0, total_tokens: total } } } }
    ];
    writeJsonLines(filePath, makeRecords(100));

    const cursor = codexDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();
    fs.writeFileSync(filePath, makeRecords(150).map(record => JSON.stringify(record)).join('\n') + '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({ tokens: expect.objectContaining({ input: 50, total: 50 }) })]);
    expect(cursor.readNewEvents()).toEqual([]);

    fs.writeFileSync(filePath, makeRecords(20).map(record => JSON.stringify(record)).join('\n') + '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({ tokens: expect.objectContaining({ input: 20, total: 20 }) })]);
  });

  test('Codex can establish a baseline without loading historical rollout files', () => {
    const filePath = path.join(testDir, 'codex', 'rollout-large.jsonl');
    writeJsonLines(filePath, [{
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, total_tokens: 100 } } }
    }]);
    let fullReads = 0;
    let chunkReads = 0;
    const trackedFs = {
      ...fs,
      readFileSync(...args) {
        fullReads += 1;
        return fs.readFileSync(...args);
      },
      readSync(...args) {
        chunkReads += 1;
        return fs.readSync(...args);
      }
    };
    const cursor = codexDriver.createDriver({
      nativeRoot: path.dirname(filePath),
      fsImpl: trackedFs
    }).createNativeLogCursor({ fs: trackedFs, skipInitialParse: true });

    cursor.initialize();
    expect(fullReads).toBe(0);
    expect(chunkReads).toBeGreaterThan(0);

    fs.appendFileSync(filePath, JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, total_tokens: 150 } } }
    }) + '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      tokens: expect.objectContaining({ input: 50, total: 50 })
    })]);
    expect(fullReads).toBe(0);
    expect(chunkReads).toBeGreaterThan(0);
  });

  test('Codex baseline fixes the file watermark and consumes an append made during bootstrap once', () => {
    const filePath = path.join(testDir, 'codex', 'rollout-watermark.jsonl');
    const baseline = [
      { type: 'session_meta', payload: { id: 'session-watermark', model_provider: 'openai' } },
      { type: 'turn_context', payload: { model: 'gpt-5' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, total_tokens: 100 } } } }
    ];
    writeJsonLines(filePath, baseline);
    const appended = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, total_tokens: 150 } } }
    }) + '\n';
    let appendedDuringBootstrap = false;
    const trackedFs = {
      ...fs,
      readSync(...args) {
        const result = fs.readSync(...args);
        if (!appendedDuringBootstrap) {
          appendedDuringBootstrap = true;
          fs.appendFileSync(filePath, appended);
        }
        return result;
      }
    };
    const cursor = codexDriver.createDriver({ nativeRoot: path.dirname(filePath), fsImpl: trackedFs })
      .createNativeLogCursor({ fs: trackedFs, skipInitialParse: true });

    cursor.initialize();
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      tokens: expect.objectContaining({ input: 50, total: 50 })
    })]);
    expect(cursor.readNewEvents()).toEqual([]);
  });

  test('Codex uses the newest model independently from the head metadata and ignores an incomplete tail until newline', () => {
    const filePath = path.join(testDir, 'codex', 'rollout-model.jsonl');
    const baseline = [
      { type: 'session_meta', payload: { id: 'session-model', model_provider: 'openai' } },
      { type: 'turn_context', payload: { model: 'old-model' } },
      { type: 'event_msg', payload: { type: 'noise', payload: { text: '"type":"turn_context"' } } },
      { type: 'turn_context', payload: { model: 'new-model' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, total_tokens: 100 } } } }
    ];
    writeJsonLines(filePath, baseline);
    const tail = JSON.stringify({
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, total_tokens: 150 } } },
      type: 'event_msg'
    });
    fs.appendFileSync(filePath, tail);
    const cursor = codexDriver.createDriver({ nativeRoot: path.dirname(filePath) })
      .createNativeLogCursor({ skipInitialParse: true });
    cursor.initialize();
    expect(cursor.readNewEvents()).toEqual([]);
    fs.appendFileSync(filePath, '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      model: 'new-model',
      tokens: expect.objectContaining({ input: 50, total: 50 })
    })]);
  });

  test('long JSONL records retain selected usage while skipping large unselected message content', () => {
    const filePath = path.join(testDir, 'claude', 'long-session.jsonl');
    writeJsonLines(filePath, [{
      type: 'assistant',
      uuid: 'old',
      message: { role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 } }
    }]);
    const cursor = claudeDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();
    fs.appendFileSync(filePath, JSON.stringify({
      type: 'assistant',
      uuid: 'long',
      message: {
        role: 'assistant',
        model: 'claude-sonnet',
        content: 'x'.repeat(300 * 1024),
        usage: { input_tokens: 20, output_tokens: 5 }
      }
    }) + '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      id: 'long-session.jsonl:long',
      tokens: expect.objectContaining({ input: 20, output: 5, total: 25 })
    })]);
  });

  test('a permanently damaged long row is discarded so later valid rows continue', () => {
    const filePath = path.join(testDir, 'claude', 'long-corrupt-session.jsonl');
    writeJsonLines(filePath, [{
      type: 'assistant',
      uuid: 'old',
      message: { role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 } }
    }]);
    const diagnostics = [];
    const cursor = claudeDriver.createDriver({ nativeRoot: path.dirname(filePath) })
      .createNativeLogCursor({ onDiagnostic: details => diagnostics.push(details) });
    cursor.initialize();
    fs.appendFileSync(filePath, `{"type":"assistant","uuid":"bad","message":{"role":"assistant","content":"${'x'.repeat(300 * 1024)}\n`);
    fs.appendFileSync(filePath, JSON.stringify({
      type: 'assistant',
      uuid: 'after-bad',
      message: { role: 'assistant', usage: { input_tokens: 6, output_tokens: 2 } }
    }) + '\n');

    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      id: 'long-corrupt-session.jsonl:after-bad',
      tokens: expect.objectContaining({ input: 6, output: 2, total: 8 })
    })]);
    expect(diagnostics.at(-1)).toEqual(expect.objectContaining({ parseErrors: 1, parsedRecords: 1 }));
  });

  test('incremental reads reuse one 64 KiB scratch buffer for all chunks in an operation', () => {
    const filePath = path.join(testDir, 'claude', 'scratch-session.jsonl');
    writeJsonLines(filePath, Array.from({ length: 4000 }, (_, index) => ({
      type: 'assistant',
      uuid: `assistant-${index}`,
      message: { role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 } }
    })));
    const scratchBuffers = new Set();
    const trackedFs = {
      ...fs,
      readSync(fd, buffer, ...args) {
        if (buffer.length === 64 * 1024) scratchBuffers.add(buffer);
        return fs.readSync(fd, buffer, ...args);
      }
    };
    const cursor = claudeDriver.createDriver({ nativeRoot: path.dirname(filePath), fsImpl: trackedFs })
      .createNativeLogCursor({ fs: trackedFs });
    cursor.initialize();
    expect(scratchBuffers.size).toBe(1);
  });

  test('a failed baseline read is retried and never advances the file watermark', () => {
    const filePath = path.join(testDir, 'codex', 'rollout-read-failure.jsonl');
    writeJsonLines(filePath, [
      { type: 'session_meta', payload: { id: 'session-read-failure', model_provider: 'openai' } },
      { type: 'turn_context', payload: { model: 'gpt-5' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, total_tokens: 100 } } } }
    ]);
    let failReads = true;
    const trackedFs = {
      ...fs,
      readSync(fd, buffer, ...args) {
        if (failReads) return 0;
        return fs.readSync(fd, buffer, ...args);
      }
    };
    const cursor = codexDriver.createDriver({ nativeRoot: path.dirname(filePath), fsImpl: trackedFs })
      .createNativeLogCursor({ fs: trackedFs, skipInitialParse: true });
    cursor.initialize();
    failReads = false;
    cursor.initialize();
    expect(cursor.readNewEvents()).toEqual([]);
    fs.appendFileSync(filePath, JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, total_tokens: 150 } } }
    }) + '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      tokens: expect.objectContaining({ input: 50, total: 50 })
    })]);
  });

  test('selective JSON parsing handles escaped strings, reordered fields, nested values and chunk boundaries', () => {
    const parser = createSelectiveJsonLineParser([
      'type', 'payload.model', 'payload.info.total_token_usage.total', 'message.usage.input'
    ]);
    const line = JSON.stringify({
      ignored: { body: 'x'.repeat(300 * 1024), pseudo: '"type":"fake"' },
      message: { usage: { input: 7 } },
      payload: { info: { total_token_usage: { total: 150 } }, model: 'gpt-5\n最新' },
      type: 'event_msg'
    });
    for (let index = 0; index < line.length; index += 97) parser.write(line.slice(index, index + 97));
    expect(parser.finish()).toEqual({
      type: 'event_msg',
      payload: { model: 'gpt-5\n最新', info: { total_token_usage: { total: 150 } } },
      message: { usage: { input: 7 } }
    });
  });

  test('forward and reverse scanners honor a fixed watermark and complete-line semantics', () => {
    const filePath = path.join(testDir, 'codex', 'scan.jsonl');
    const complete = [JSON.stringify({ id: 'one' }), JSON.stringify({ id: 'two' })].join('\n') + '\n';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, complete + JSON.stringify({ id: 'partial' }));
    const forward = [];
    visitJsonLinesForward(filePath, record => { forward.push(record.id); }, { endOffset: Buffer.byteLength(complete) });
    const reverse = [];
    visitJsonLinesReverse(filePath, record => { reverse.push(record.id); }, { includeTrailingLine: false });
    expect(forward).toEqual(['one', 'two']);
    expect(reverse).toEqual(['two', 'one']);
  });

  test('Codex normalizes cached_input_tokens as a separately billable cache read', () => {
    const filePath = path.join(testDir, 'codex', 'rollout-cached.jsonl');
    const makeRecords = ({ input, cached, output, total }) => [
      { type: 'session_meta', payload: { id: 'session-cached', model_provider: 'openai' } },
      { type: 'turn_context', payload: { model: 'gpt-5.5' } },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
            total_tokens: total
          } }
        }
      }
    ];
    writeJsonLines(filePath, makeRecords({ input: 100, cached: 80, output: 20, total: 120 }));

    const cursor = codexDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();
    fs.writeFileSync(filePath, makeRecords({ input: 200, cached: 160, output: 40, total: 240 }).map(record => JSON.stringify(record)).join('\n') + '\n');

    const [event] = cursor.readNewEvents();
    expect(event.tokens).toEqual(expect.objectContaining({
      input: 20,
      cacheRead: 80,
      cached: 80,
      output: 20,
      total: 120
    }));
    expect(event.cost).toBeCloseTo(0.00074, 8);
  });

  test('Gemini does not replay old messages when the JSON session is rewritten', () => {
    const filePath = path.join(testDir, 'gemini', 'session-a.json');
    const first = { sessionId: 'gemini-session', messages: [{ id: 'message-1', model: 'gemini-pro', usage: { input_tokens: 8, output_tokens: 2 } }] };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(first));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T00:00:00.000Z'));
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();

    vi.advanceTimersByTime(15 * 1000);
    fs.writeFileSync(filePath, JSON.stringify({
      ...first,
      messages: [...first.messages, { id: 'message-2', usage: { input_tokens: 3, output_tokens: 1 } }]
    }));
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({ id: 'session-a.json:message-2' })]);
    expect(cursor.readNewEvents()).toEqual([]);
  });

  test('Gemini baseline skips history on the first rewrite and batches pending events', () => {
    const filePath = path.join(testDir, 'gemini', 'session-baseline.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const messages = Array.from({ length: 1200 }, (_, i) => ({ id: `old-${i}`, usage: { input_tokens: 1 } }));
    fs.writeFileSync(filePath, JSON.stringify({ messages }));
    vi.useFakeTimers();
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor({ skipInitialParse: true });
    cursor.initialize();
    vi.advanceTimersByTime(15 * 1000);
    fs.writeFileSync(filePath, JSON.stringify({ messages: [...messages, ...Array.from({ length: 1100 }, (_, i) => ({ id: `new-${i}`, usage: { input_tokens: 2 } }))] }));
    const batches = [cursor.readNewEvents(), cursor.readNewEvents(), cursor.readNewEvents()];
    expect(batches.map(batch => batch.length)).toEqual([500, 500, 100]);
    expect(batches.flat().every(event => !event.id.includes('old-'))).toBe(true);
    expect(cursor.readNewEvents()).toEqual([]);
    cursor.close();
  });

  test('Gemini shutdown force reads the final JSON rewrite within the polling interval', () => {
    const filePath = path.join(testDir, 'gemini', 'session-final.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ messages: [] }));
    vi.useFakeTimers();
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor({ skipInitialParse: true });
    try {
      cursor.initialize();
      fs.writeFileSync(filePath, JSON.stringify({ messages: [{ id: 'final', usage: { input: 2 } }] }));
      expect(cursor.readNewEvents()).toEqual([]);
      expect(cursor.readNewEvents({ force: true })).toEqual([expect.objectContaining({ id: 'session-final.json:final' })]);
      expect(cursor.readNewEvents({ force: true })).toEqual([]);
    } finally { cursor.close(); }
  });

  test('Gemini uses a deterministic content version when a message has no id', () => {
    const filePath = path.join(testDir, 'gemini', 'session-b.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'gemini-session-b',
      messages: [{ model: 'gemini-pro', usage: { input_tokens: 4, output_tokens: 1 } }]
    }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T00:00:00.000Z'));
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();

    vi.advanceTimersByTime(15 * 1000);
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'gemini-session-b',
      messages: [
        { model: 'gemini-pro', usage: { input_tokens: 4, output_tokens: 1 } },
        { model: 'gemini-pro', usage: { input_tokens: 5, output_tokens: 2 } }
      ]
    }));
    const [event] = cursor.readNewEvents();
    expect(event.id).toMatch(/^session-b\.json:[a-f0-9]{40}$/);
    expect(cursor.readNewEvents()).toEqual([]);
  });

  test('Gemini normalizes usageMetadata cache and thinking fields', () => {
    const filePath = path.join(testDir, 'gemini', 'session-metadata.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'gemini-session-metadata',
      messages: [{
        id: 'message-1',
        model: 'gemini-2.5-pro',
        usage: {
          promptTokenCount: 100,
          cachedContentTokenCount: 80,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 5,
          totalTokenCount: 125
        }
      }]
    }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T00:00:00.000Z'));
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();
    vi.advanceTimersByTime(15 * 1000);
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'gemini-session-metadata',
      messages: [{
        id: 'message-1',
        model: 'gemini-2.5-pro',
        usage: {
          promptTokenCount: 200,
          cachedContentTokenCount: 180,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 10,
          totalTokenCount: 250
        }
      }, {
        id: 'message-2',
        model: 'gemini-2.5-pro',
        usage: {
          promptTokenCount: 200,
          cachedContentTokenCount: 180,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 10,
          totalTokenCount: 250
        }
      }]
    }));

    const [event] = cursor.readNewEvents();
    expect(event.tokens).toEqual(expect.objectContaining({
      input: 20,
      cacheRead: 180,
      cached: 180,
      output: 40,
      reasoning: 10,
      total: 250
    }));
  });

  test('Gemini JSONL reads only appended complete rows, including split UTF-8', () => {
    const filePath = path.join(testDir, 'gemini', 'session-incremental.jsonl');
    writeJsonLines(filePath, [{ id: 'old', usage: { input_tokens: 1, output_tokens: 1 } }]);
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();

    const row = Buffer.from(JSON.stringify({
      id: 'new',
      content: '你好',
      usage: { input_tokens: 4, output_tokens: 2 }
    }));
    const splitAt = row.indexOf(Buffer.from('你')) + 1;
    fs.appendFileSync(filePath, row.subarray(0, splitAt));
    expect(cursor.readNewEvents()).toEqual([]);

    fs.appendFileSync(filePath, Buffer.concat([row.subarray(splitAt), Buffer.from('\n')]));
    expect(cursor.readNewEvents()).toEqual([
      expect.objectContaining({
        id: 'session-incremental.jsonl:new',
        tokens: expect.objectContaining({ input: 4, output: 2, total: 6 })
      })
    ]);
    expect(cursor.readNewEvents()).toEqual([]);
  });

  test('Gemini JSONL keeps usage from an oversized message body', () => {
    const filePath = path.join(testDir, 'gemini', 'session-long.jsonl');
    writeJsonLines(filePath, [{ id: 'old', usage: { input_tokens: 1, output_tokens: 1 } }]);
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();
    fs.appendFileSync(filePath, JSON.stringify({
      id: 'long',
      message: {
        content: 'x'.repeat(300 * 1024),
        usage: { input_tokens: 12, output_tokens: 4 }
      }
    }) + '\n');
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      id: 'session-long.jsonl:long',
      tokens: expect.objectContaining({ input: 12, output: 4, total: 16 })
    })]);
  });

  test('Gemini oversized JSON sessions are not parsed and warn only once', () => {
    const filePath = path.join(testDir, 'gemini', 'session-oversized.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
    fs.truncateSync(filePath, 16 * 1024 * 1024 + 1);
    let fullReads = 0;
    const trackedFs = {
      ...fs,
      readFileSync(...args) {
        fullReads += 1;
        return fs.readFileSync(...args);
      }
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cursor = geminiDriver.createDriver({
      nativeRoot: path.dirname(filePath),
      fsImpl: trackedFs
    }).createNativeLogCursor({ fs: trackedFs, skipInitialParse: true });

    cursor.initialize();
    expect(cursor.readNewEvents()).toEqual([]);
    fs.appendFileSync(filePath, 'x');
    expect(cursor.readNewEvents()).toEqual([]);
    expect(fullReads).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('OpenCode native log cursor', () => {
  test('attaches checkpoints read-only and keeps source bodies out of the hot cache', () => {
    const { createNativeLogCheckpoints } = require('../../../src/server/services/native-log-checkpoints');
    const store = createNativeLogCheckpoints({ directory: testDir });
    const db = new DatabaseSync(':memory:');
    try {
      store.set('rows', 'one', { tokens: { input: 1 } }, { data: 'x'.repeat(1024 * 1024) });
      expect(store.diagnostics().hotBytes).toBeLessThan(1024);
      store.attachReadOnly(db);
      expect(() => db.exec('DELETE FROM native_checkpoints.states')).toThrow(/readonly/i);
      expect(store.get('rows', 'one')).toEqual({ tokens: { input: 1 } });
    } finally { db.close(); store.close(); }
  });

  test('skips unchanged usage parsing but detects old part and parent message edits', () => {
    const dbPath = path.join(testDir, 'opencode-edits.db');
    process.env.OPENCODE_DB_PATH = dbPath;
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, data TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);');
    db.prepare('INSERT INTO message VALUES (?, ?)').run('m', JSON.stringify({ modelID: 'gpt-5.5', providerID: 'first' }));
    const insert = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('old', 'm', 's', 1, 1, JSON.stringify({ tokens: { input: 10 } }));
    const diagnostics = [];
    const cursor = opencodeDriver.createDriver().createNativeLogCursor({ onDiagnostic: value => diagnostics.push(value) });
    try {
      cursor.initialize();
      insert.run('new', 'm', 's', 2, 2, JSON.stringify({ tokens: { input: 1 } }));
      expect(cursor.readNewEvents()).toHaveLength(1);
      expect(diagnostics.at(-1).parsedRecords).toBe(1);
      db.prepare('UPDATE message SET data = ?').run(JSON.stringify({ modelID: 'gpt-5.5', providerID: 'second' }));
      expect(cursor.readNewEvents()).toEqual([]);
      expect(diagnostics.at(-1).parsedRecords).toBe(2);
      db.prepare('UPDATE message SET data = ?').run(JSON.stringify({ modelID: 'gpt-5.5', providerID: 'second', content: 'unrelated content' }));
      expect(cursor.readNewEvents()).toEqual([]);
      expect(diagnostics.at(-1).parsedRecords).toBe(0);
      db.prepare('UPDATE part SET data = ? WHERE id = ?').run(JSON.stringify({ tokens: { input: 13 } }), 'old');
      expect(cursor.readNewEvents()).toEqual([expect.objectContaining({ provider: 'second', tokens: expect.objectContaining({ input: 3 }) })]);
      expect(diagnostics.at(-1).parsedRecords).toBe(1);
      expect(cursor.readNewEvents()).toEqual([]);
    } finally { cursor.close(); db.close(); }
  });

  test('evicted OpenCode baselines still produce exact deltas and bounded batches', () => {
    const dbPath = path.join(testDir, 'opencode-many.db');
    process.env.OPENCODE_DB_PATH = dbPath;
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, data TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);');
    const insert = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < 1300; i++) insert.run(`part-${i}`, 'message', 'session', i, i, JSON.stringify({ tokens: { input: 10 } }));
    const cursor = opencodeDriver.createDriver().createNativeLogCursor();
    try {
      cursor.initialize();
      expect(cursor.diagnostics().hotEntries).toBeLessThanOrEqual(1024);
      expect(cursor.diagnostics().hotBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      db.prepare('UPDATE part SET data = ? WHERE id = ?').run(JSON.stringify({ tokens: { input: 13 } }), 'part-0');
      expect(cursor.readNewEvents()).toEqual([expect.objectContaining({ tokens: expect.objectContaining({ input: 3 }) })]);
      expect(cursor.readNewEvents()).toEqual([]);
      for (let i = 1300; i < 2400; i++) insert.run(`part-${i}`, 'message', 'session', i, i, JSON.stringify({ tokens: { input: 1 } }));
      const batches = [cursor.readNewEvents(), cursor.readNewEvents(), cursor.readNewEvents()];
      expect(batches.map(batch => batch.length)).toEqual([500, 500, 100]);
      expect(new Set(batches.flat().map(event => event.id)).size).toBe(1100);
      expect(cursor.readNewEvents()).toEqual([]);
    } finally { cursor.close(); db.close(); }
  });

  test('uses a read-only SQLite connection and reads stable usage rows once', () => {
    const dbPath = path.join(testDir, 'opencode.db');
    process.env.OPENCODE_DB_PATH = dbPath;
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    `);
    db.prepare('INSERT INTO session (id) VALUES (?)').run('session-1');
    db.prepare('INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)').run('message-1', 'session-1', JSON.stringify({ modelID: 'gpt-5', providerID: 'openai' }));
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run('part-1', 'message-1', 'session-1', 100, 100, JSON.stringify({ type: 'step-finish', tokens: { input: 7, output: 3 }, cost: 0.02 }));
    const cursor = opencodeDriver.createDriver().createNativeLogCursor();
    cursor.initialize();
    db.prepare('UPDATE part SET time_updated = time_updated + 1').run();
    const events = cursor.readNewEvents();
    expect(events).toEqual([]);

    db.prepare('UPDATE part SET data = ?').run(JSON.stringify({
      type: 'step-finish',
      tokens: { input: 8, output: 3 },
      cost: 0.02
    }));
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^opencode:session-1:part-1:/),
      tokens: expect.objectContaining({ input: 1, total: 1 })
    })]);

    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run('part-2', 'message-1', 'session-1', 200, 200, JSON.stringify({ type: 'step-finish', tokens: { input: 2, output: 1 } }));
    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      id: 'opencode:session-1:part-2',
      model: 'gpt-5',
      provider: 'openai'
    })]);
    db.close();
  });
});


describe('checkpoint disk failures', () => {
  function withFailingCheckpoint(callback) {
    const utilsPath = require.resolve('../../../src/platforms/drivers/native-log-utils');
    const checkpointPath = require.resolve('../../../src/server/services/native-log-checkpoints');
    const previousUtils = require.cache[utilsPath];
    const checkpointModule = require(checkpointPath);
    const realCreate = checkpointModule.createNativeLogCheckpoints;
    let fail = true;
    checkpointModule.createNativeLogCheckpoints = options => {
      const store = realCreate(options);
      return { ...store, enqueue(event) {
        if (fail) throw new Error('injected checkpoint disk failure');
        return store.enqueue(event);
      } };
    };
    delete require.cache[utilsPath];
    const utils = require(utilsPath);
    try { callback(utils, () => { fail = false; }); } finally {
      checkpointModule.createNativeLogCheckpoints = realCreate;
      require.cache[utilsPath] = previousUtils;
    }
  }

  test('JSONL retries the same failed overflow event before committing its offset', () => {
    vi.useFakeTimers();
    withFailingCheckpoint((utils, recover) => {
      const filePath = path.join(testDir, 'retry.jsonl');
      writeJsonLines(filePath, []);
      let parsed = 0;
      const cursor = utils.createIncrementalJsonlCursor({
        scanFiles: () => [filePath],
        parseLine: (_path, record) => { parsed++; return record.events; },
        onError: () => {}
      });
      try {
        cursor.initialize();
        const events = Array.from({ length: 501 }, (_, i) => ({ id: `retry-${i}`, tokens: { input: 1 } }));
        writeJsonLines(filePath, [{ events }]);
        expect(cursor.readNewEvents()).toEqual(events.slice(0, 500));
        expect(cursor.diagnostics().persistenceBlocked).toBe(true);
        expect(cursor.readNewEvents()).toEqual([]);
        vi.advanceTimersByTime(1000);
        expect(cursor.readNewEvents()).toEqual([]);
        expect(cursor.diagnostics().persistenceBlocked).toBe(true);
        recover(); vi.advanceTimersByTime(2000);
        expect(cursor.readNewEvents()).toEqual([events[500]]);
        expect(cursor.diagnostics().persistenceBlocked).toBe(false);
        expect(cursor.readNewEvents()).toEqual([]);
        expect(parsed).toBe(1);
        fs.appendFileSync(filePath, JSON.stringify({ events: [{ id: 'after-retry', tokens: { input: 2 } }] }) + '\n');
        expect(cursor.readNewEvents()).toEqual([expect.objectContaining({ id: 'after-retry' })]);
      } finally { cursor.close(); }
    });
  });

  test('scanned JSON rollback retries all identical IDs after overflow persistence recovers', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withFailingCheckpoint((utils, recover) => {
      const filePath = path.join(testDir, 'retry.json');
      fs.writeFileSync(filePath, JSON.stringify([]));
      const cursor = utils.createScannedFileCursor({
        scanFiles: () => [filePath], parseFile: () => JSON.parse(fs.readFileSync(filePath, 'utf8')),
        normalizeEvent: event => event, parseBaseline: true
      });
      try {
        cursor.initialize();
        const events = Array.from({ length: 1100 }, (_, i) => ({ id: `same-id-${i}`, tokens: { input: 1 } }));
        fs.writeFileSync(filePath, JSON.stringify(events));
        expect(cursor.readNewEvents()).toEqual([]);
        expect(cursor.diagnostics().persistenceBlocked).toBe(true);
        for (let i = 0; i < 10; i++) expect(cursor.readNewEvents()).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        recover(); vi.advanceTimersByTime(1000);
        const actual = [cursor.readNewEvents(), cursor.readNewEvents(), cursor.readNewEvents()];
        expect(actual.map(batch => batch.length)).toEqual([500, 500, 100]);
        expect(actual.flat()).toEqual(events);
        expect(cursor.diagnostics().persistenceBlocked).toBe(false);
        expect(cursor.readNewEvents()).toEqual([]);
      } finally { cursor.close(); }
    });
    warn.mockRestore();
  });

  test('Gemini whole JSON retries its unchanged source after a failed pending write', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withFailingCheckpoint((_utils, recover) => {
      const driverPath = require.resolve('../../../src/platforms/drivers/gemini/native-logs');
      const previousDriver = require.cache[driverPath];
      delete require.cache[driverPath];
      const driver = require(driverPath);
      const filePath = path.join(testDir, 'gemini-retry', 'session-retry.json');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ messages: [{ id: 'old', tokens: { input: 1 } }] }));
      const cursor = driver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor({ skipInitialParse: true });
      try {
        cursor.initialize(); vi.advanceTimersByTime(15_000);
        const messages = Array.from({ length: 501 }, (_, i) => ({ id: `same-${i}`, tokens: { input: 2 } }));
        fs.writeFileSync(filePath, JSON.stringify({ messages: [{ id: 'old', tokens: { input: 1 } }, ...messages] }));
        expect(cursor.readNewEvents()).toEqual([]);
        expect(cursor.diagnostics().persistenceBlocked).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(cursor.readNewEvents()).toEqual([]);
        expect(cursor.diagnostics().persistenceBlocked).toBe(true);
        recover(); vi.advanceTimersByTime(2000);
        const batches = [cursor.readNewEvents(), cursor.readNewEvents()];
        expect(batches.map(batch => batch.length)).toEqual([500, 1]);
        expect(batches.flat().map(event => event.id)).toEqual(messages.map(message => `session-retry.json:${message.id}`));
        expect(cursor.readNewEvents()).toEqual([]);
      } finally { cursor.close(); require.cache[driverPath] = previousDriver; }
    });
    warn.mockRestore();
  });
});
