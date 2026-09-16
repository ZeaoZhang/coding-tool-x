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
