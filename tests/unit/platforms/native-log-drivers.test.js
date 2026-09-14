'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const claudeDriver = require('../../../src/platforms/drivers/claude/native-logs');
const codexDriver = require('../../../src/platforms/drivers/codex/native-logs');
const geminiDriver = require('../../../src/platforms/drivers/gemini/native-logs');
const opencodeDriver = require('../../../src/platforms/drivers/opencode/native-logs');

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
});

describe('file-backed native log cursors', () => {
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

  test('Gemini does not replay old messages when the JSON session is rewritten', () => {
    const filePath = path.join(testDir, 'gemini', 'session-a.json');
    const first = { sessionId: 'gemini-session', messages: [{ id: 'message-1', model: 'gemini-pro', usage: { input_tokens: 8, output_tokens: 2 } }] };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(first));
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();

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
    const cursor = geminiDriver.createDriver({ nativeRoot: path.dirname(filePath) }).createNativeLogCursor();
    cursor.initialize();

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
