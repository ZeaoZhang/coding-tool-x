import { describe, it, afterEach, expect, vi } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createSessionHistoryIndex } from '../../../src/server/services/session-history-index.js';
const require = createRequire(import.meta.url);
const runtimeModule = require('../../../src/platforms/runtime');

function makeSessionFixture(sessionId, projectName = 'test-project', overrides = {}) {
  const now = Date.now();
  return {
    sessionId,
    projectName,
    projectDisplayName: overrides.projectDisplayName || projectName,
    projectFullPath: overrides.projectFullPath || `/home/user/${projectName}`,
    firstMessage: Object.prototype.hasOwnProperty.call(overrides, 'firstMessage')
      ? overrides.firstMessage
      : 'Hello, this is a test',
    gitBranch: Object.prototype.hasOwnProperty.call(overrides, 'gitBranch')
      ? overrides.gitBranch
      : 'main',
    provider: Object.prototype.hasOwnProperty.call(overrides, 'provider')
      ? overrides.provider
      : 'anthropic',
    model: Object.prototype.hasOwnProperty.call(overrides, 'model')
      ? overrides.model
      : 'claude-sonnet-4-20250514',
    startedAt: Object.prototype.hasOwnProperty.call(overrides, 'startedAt')
      ? overrides.startedAt
      : now - 3600000,
    updatedAt: Object.prototype.hasOwnProperty.call(overrides, 'updatedAt')
      ? overrides.updatedAt
      : now,
    usageJson: Object.prototype.hasOwnProperty.call(overrides, 'usageJson')
      ? overrides.usageJson
      : null,
    extraJson: Object.prototype.hasOwnProperty.call(overrides, 'extraJson')
      ? overrides.extraJson
      : '{}'
  };
}

function makeMessageFixtures(count = 3, { userPrefix = 'User message', assistantPrefix = 'Assistant response' } = {}) {
  const messages = [];
  let userMessageNumber = 0;
  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0;
    if (isUser) userMessageNumber += 1;
    messages.push({
      messageId: `msg-${i}`,
      role: isUser ? 'user' : 'assistant',
      type: isUser ? 'user' : 'assistant',
      subtype: null,
      content: isUser ? `${userPrefix} ${userMessageNumber}` : `${assistantPrefix} ${userMessageNumber}`,
      timestamp: Date.now() - (count - i) * 60000,
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      userMessageNumber: isUser ? userMessageNumber : null,
      extraJson: null
    });
  }
  return messages;
}

function createFixtureState() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-index-'));
  const dbPath = path.join(rootDir, 'session-history.sqlite');
  const descriptors = new Map();
  const parsePayloads = new Map();
  const parseCounts = new Map();

  function writeFixtureFile({ name, content, session, messages, projectHint = session.projectName }) {
    const filePath = path.join(rootDir, name);
    fs.writeFileSync(filePath, content, 'utf8');
    const stat = fs.statSync(filePath);
    const descriptor = {
      filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sessionId: session.sessionId,
      projectHint
    };
    descriptors.set(filePath, descriptor);
    parsePayloads.set(filePath, { session, messages });
    return descriptor;
  }

  function rewriteFixtureFile(filePath, content, payload) {
    fs.writeFileSync(filePath, content, 'utf8');
    const stat = fs.statSync(filePath);
    const current = descriptors.get(filePath);
    if (!current) {
      throw new Error(`Missing fixture descriptor for ${filePath}`);
    }
    current.size = stat.size;
    current.mtimeMs = stat.mtimeMs;
    if (payload) {
      parsePayloads.set(filePath, payload);
    }
    return current;
  }

  function removeFixtureFile(filePath) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    descriptors.delete(filePath);
    parsePayloads.delete(filePath);
  }

  function inventory() {
    return Array.from(descriptors.values()).map((descriptor) => {
      const stat = fs.statSync(descriptor.filePath);
      return {
        ...descriptor,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      };
    });
  }

  const adapter = {
    inventory: vi.fn(async () => inventory()),
    parse: vi.fn(async (descriptor) => {
      const payload = parsePayloads.get(descriptor.filePath);
      if (!payload) {
        throw new Error(`Missing payload for ${descriptor.filePath}`);
      }
      parseCounts.set(descriptor.filePath, (parseCounts.get(descriptor.filePath) || 0) + 1);
      return payload;
    })
  };

  function cleanup() {
    try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
  }

  return {
    rootDir,
    dbPath,
    descriptors,
    parseCounts,
    adapter,
    writeFixtureFile,
    rewriteFixtureFile,
    removeFixtureFile,
    cleanup
  };
}

describe('session-history-index', () => {
  let state;
  let index;

  afterEach(() => {
    vi.useRealTimers();
    if (index) {
      try { index.closeSessionHistoryIndex(); } catch (_) {}
    }
    if (state) {
      state.cleanup();
    }
    state = null;
    index = null;
  });

  function setupIndex({ ftsEnabledOverride = false } = {}) {
    state = createFixtureState();
    index = createSessionHistoryIndex({
      dbPath: state.dbPath,
      adapterRegistry: { claude: state.adapter },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride
    });
    return state;
  }

  it('cold inventory parses every valid file exactly once', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 's1.jsonl',
      content: '{"type":"metadata"}\n',
      session: makeSessionFixture('s1', 'test-proj'),
      messages: makeMessageFixtures(4)
    });
    fixture.writeFixtureFile({
      name: 's2.jsonl',
      content: '{"type":"metadata"}\n',
      session: makeSessionFixture('s2', 'test-proj'),
      messages: makeMessageFixtures(4)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    expect(fixture.parseCounts.get(path.join(fixture.rootDir, 's1.jsonl'))).toBe(1);
    expect(fixture.parseCounts.get(path.join(fixture.rootDir, 's2.jsonl'))).toBe(1);
  });

  it('second inventory with unchanged files parses zero', async () => {
    const fixture = setupIndex();
    const filePath = path.join(fixture.rootDir, 's1.jsonl');
    fixture.writeFixtureFile({
      name: 's1.jsonl',
      content: '{"type":"metadata"}\n',
      session: makeSessionFixture('s1', 'test-proj'),
      messages: makeMessageFixtures(4)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });
    const firstCount = fixture.parseCounts.get(filePath) || 0;

    await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' });

    expect(fixture.parseCounts.get(filePath)).toBe(firstCount);
  });

  it('changing one file reparses exactly one', async () => {
    const fixture = setupIndex();
    const fileA = fixture.writeFixtureFile({
      name: 's1.jsonl',
      content: 'first version\n',
      session: makeSessionFixture('s1', 'test-proj'),
      messages: makeMessageFixtures(4)
    });
    const fileB = fixture.writeFixtureFile({
      name: 's2.jsonl',
      content: 'first version\n',
      session: makeSessionFixture('s2', 'test-proj'),
      messages: makeMessageFixtures(4)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });
    const countA1 = fixture.parseCounts.get(fileA.filePath) || 0;
    const countB1 = fixture.parseCounts.get(fileB.filePath) || 0;

    fixture.rewriteFixtureFile(fileB.filePath, 'second version with extra bytes\n', {
      session: makeSessionFixture('s2', 'test-proj'),
      messages: makeMessageFixtures(4)
    });

    await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' });

    expect(fixture.parseCounts.get(fileA.filePath)).toBe(countA1);
    expect(fixture.parseCounts.get(fileB.filePath)).toBe(countB1 + 1);
  });

  it('duplicate session ID keeps greatest mtimeMs', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 'older.jsonl',
      content: 'older\n',
      session: makeSessionFixture('dup', 'test-proj', { firstMessage: 'older' }),
      messages: [
        {
          messageId: 'm1',
          role: 'user',
          type: 'user',
          subtype: null,
          content: 'older message',
          timestamp: Date.now() - 60000,
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic',
          userMessageNumber: 1,
          extraJson: null
        }
      ]
    });
    const newer = fixture.writeFixtureFile({
      name: 'newer.jsonl',
      content: 'newer with more bytes\n',
      session: makeSessionFixture('dup', 'test-proj', { firstMessage: 'newer wins' }),
      messages: [
        {
          messageId: 'm1',
          role: 'user',
          type: 'user',
          subtype: null,
          content: 'newer wins message',
          timestamp: Date.now(),
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic',
          userMessageNumber: 1,
          extraJson: null
        }
      ]
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const outline = await index.getSessionOutline('claude', 'dup');
    expect(outline).not.toBeNull();
    expect(outline.items).toHaveLength(1);
    expect(outline.items[0].preview).toBe('newer wins message');
    expect(fixture.parseCounts.get(newer.filePath)).toBe(1);
  });
  it('duplicate session ID keeps the greatest mtimeMs even when inventory order is reversed', async () => {
    const fixture = setupIndex();
    const newer = fixture.writeFixtureFile({
      name: 'newer.jsonl',
      content: 'newer\n',
      session: makeSessionFixture('dup', 'test-proj', { firstMessage: 'newer wins' }),
      messages: [
        {
          messageId: 'm1',
          role: 'user',
          type: 'user',
          subtype: null,
          content: 'newer wins message',
          timestamp: Date.now(),
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic',
          userMessageNumber: 1,
          extraJson: null
        }
      ]
    });
    const older = fixture.writeFixtureFile({
      name: 'older.jsonl',
      content: 'older\n',
      session: makeSessionFixture('dup', 'test-proj', { firstMessage: 'older' }),
      messages: [
        {
          messageId: 'm1',
          role: 'user',
          type: 'user',
          subtype: null,
          content: 'older message',
          timestamp: Date.now() - 60000,
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic',
          userMessageNumber: 1,
          extraJson: null
        }
      ]
    });

    fixture.rewriteFixtureFile(newer.filePath, 'newer with even more bytes\n', {
      session: makeSessionFixture('dup', 'test-proj', { firstMessage: 'newer wins' }),
      messages: [
        {
          messageId: 'm1',
          role: 'user',
          type: 'user',
          subtype: null,
          content: 'newer wins message',
          timestamp: Date.now(),
          model: 'claude-sonnet-4-20250514',
          provider: 'anthropic',
          userMessageNumber: 1,
          extraJson: null
        }
      ]
    });

    fixture.adapter.inventory.mockResolvedValueOnce([
      { ...older },
      { ...newer }
    ]);

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const outline = await index.getSessionOutline('claude', 'dup');
    expect(outline).not.toBeNull();
    expect(outline.items).toHaveLength(1);
    expect(outline.items[0].preview).toBe('newer wins message');
    expect(fixture.parseCounts.get(newer.filePath)).toBe(1);
    expect(fixture.parseCounts.get(older.filePath) || 0).toBe(0);
  });

  it('persists retry stat metadata when a file changes during parse and retry succeeds', async () => {
    const fixture = setupIndex();
    const descriptor = fixture.writeFixtureFile({
      name: 'retry-metadata.jsonl',
      content: 'old content\n',
      session: makeSessionFixture('retry-metadata', 'retry-project'),
      messages: makeMessageFixtures(2)
    });
    const oldSize = descriptor.size;
    const oldMtimeMs = descriptor.mtimeMs;
    let retrySize;
    let retryMtimeMs;

    fixture.adapter.parse.mockImplementation(async () => {
      const count = fixture.parseCounts.get(descriptor.filePath) || 0;
      fixture.parseCounts.set(descriptor.filePath, count + 1);
      if (count === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        fs.writeFileSync(descriptor.filePath, 'retry content with newer metadata\n', 'utf8');
        const retryStat = fs.statSync(descriptor.filePath);
        retrySize = retryStat.size;
        retryMtimeMs = retryStat.mtimeMs;
      }
      return {
        session: makeSessionFixture('retry-metadata', 'retry-project'),
        messages: makeMessageFixtures(2)
      };
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    expect(fixture.parseCounts.get(descriptor.filePath)).toBe(2);
    expect(retrySize).not.toBe(oldSize);
    expect(retryMtimeMs).not.toBe(oldMtimeMs);
    const row = index._getDb().prepare(
      'SELECT size, mtime_ms FROM session_file WHERE source = ? AND session_id = ?'
    ).get('claude', 'retry-metadata');
    expect(row).toMatchObject({ size: retrySize, mtime_ms: retryMtimeMs });
  });

  it('deletion removes session and message rows', async () => {
    const fixture = setupIndex();
    const filePath = fixture.writeFixtureFile({
      name: 's1.jsonl',
      content: 'initial\n',
      session: makeSessionFixture('s1', 'test-proj'),
      messages: makeMessageFixtures(4)
    }).filePath;

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });
    expect(await index.getSessionStatus('claude', 's1')).not.toBeNull();

    fixture.removeFixtureFile(filePath);
    await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' });

    expect(await index.getSessionStatus('claude', 's1')).toBeNull();
  });

  it('listProjects returns aggregated project data', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 's1.jsonl',
      content: 'a\n',
      session: makeSessionFixture('s1', 'test-proj', { updatedAt: 1000 }),
      messages: makeMessageFixtures(4)
    });
    fixture.writeFixtureFile({
      name: 's2.jsonl',
      content: 'b\n',
      session: makeSessionFixture('s2', 'test-proj', { updatedAt: 2000 }),
      messages: makeMessageFixtures(4)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const projects = await index.listProjects('claude');
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('test-proj');
    expect(projects[0].sessionCount).toBe(2);
    expect(projects[0].latestSession).toBe('s2');
  });

  it('listSessions returns indexed session metadata', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 's1.jsonl',
      content: 'a\n',
      session: makeSessionFixture('s1', 'proj-a', { updatedAt: 2000 }),
      messages: makeMessageFixtures(4)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const sessions = await index.listSessions('claude', 'proj-a');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('s1');
    expect(sessions[0].firstMessage).toBe('Hello, this is a test');
    expect(sessions[0].projectName).toBe('proj-a');
  });

  it('getSessionStatus returns lightweight status', async () => {
    const fixture = setupIndex();
    const filePath = fixture.writeFixtureFile({
      name: 'status.jsonl',
      content: 'status fixture\n',
      session: makeSessionFixture('s1', 'proj-a'),
      messages: makeMessageFixtures(2)
    }).filePath;

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const status = await index.getSessionStatus('claude', 's1');
    expect(status).not.toBeNull();
    expect(status.sessionId).toBe('s1');
    expect(typeof status.lastModified).toBe('number');
    expect(typeof status.size).toBe('number');
    expect(status.filePath).toBe(filePath);
  });

  it('getSessionOutline returns indexed user entries', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 'outline.jsonl',
      content: 'outline fixture\n',
      session: makeSessionFixture('s1', 'proj-a'),
      messages: makeMessageFixtures(6)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const outline = await index.getSessionOutline('claude', 's1');
    expect(outline).not.toBeNull();
    expect(outline.items).toHaveLength(3);
    expect(outline.items[0].userMessageNumber).toBe(1);
    expect(outline.items[0].preview).toContain('User message 1');
  });

  it('getMessagePage returns paginated messages', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 'page.jsonl',
      content: 'page fixture\n',
      session: makeSessionFixture('s1', 'proj-a'),
      messages: makeMessageFixtures(10)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const page = await index.getMessagePage('claude', 's1', { page: 1, limit: 3, order: 'asc' });
    expect(page).not.toBeNull();
    expect(page.messages).toHaveLength(3);
    expect(page.pagination.page).toBe(1);
    expect(page.pagination.limit).toBe(3);
    expect(page.pagination.total).toBe(10);
    expect(page.pagination.hasMore).toBe(true);

    const page2 = await index.getMessagePage('claude', 's1', { page: 2, limit: 3, order: 'asc' });
    expect(page2.messages).toHaveLength(3);
    const overlap = page.messages.map(m => m.messageId).filter(id => page2.messages.some(m => m.messageId === id));
    expect(overlap).toHaveLength(0);
  });
  it('uses refreshed descriptor metadata when retry parsing a concurrently changed runtime session file', async () => {
    const fixture = setupIndex();
    const descriptor = fixture.writeFixtureFile({
      name: 'retry-runtime.jsonl',
      content: 'first version\n',
      session: makeSessionFixture('retry-session', 'proj-a', { updatedAt: 111, extraJson: JSON.stringify({ keep: true }) }),
      messages: makeMessageFixtures(1)
    });
    let parseCall = 0;
    const parsedDescriptors = [];
    fixture.adapter.parse.mockImplementation(async (receivedDescriptor) => {
      parsedDescriptors.push({ ...receivedDescriptor });
      parseCall += 1;
      if (parseCall === 1) {
        fs.writeFileSync(descriptor.filePath, 'second version with more bytes\n', 'utf8');
        return {
          session: { ...makeSessionFixture('retry-session', 'proj-a', { updatedAt: 111, extraJson: JSON.stringify({ keep: true }) }), projectHint: 'proj-a' },
          messages: makeMessageFixtures(1)
        };
      }
      return {
        session: { ...makeSessionFixture('retry-session', 'proj-a', { updatedAt: 222, extraJson: JSON.stringify({ keep: true }) }), projectHint: 'proj-a' },
        messages: makeMessageFixtures(1)
      };
    });
    index.closeSessionHistoryIndex();
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    index = createSessionHistoryIndex({
      dbPath: fixture.dbPath,
      runtime: { getDriver: () => fixture.adapter },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });


    try {
      await index.ensureSourceIndexed('claude', { consistency: 'complete' });

      expect(fixture.adapter.parse).toHaveBeenCalledTimes(2);
      const finalStat = fs.statSync(descriptor.filePath);
      expect(parsedDescriptors[1].size).toBe(finalStat.size);
      expect(parsedDescriptors[1].mtimeMs).toBe(finalStat.mtimeMs);
      const sessions = await index.listSessions('claude', 'proj-a');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].size).toBe(finalStat.size);
      expect(sessions[0].mtime).toBe(finalStat.mtimeMs);
      expect(sessions[0].updatedAt).toBe(finalStat.mtimeMs);
      expect(sessions[0].extra).toMatchObject({ keep: true, projectHint: 'proj-a', mtimeMs: finalStat.mtimeMs });
    } finally {
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
    }
  });

  it('treats malformed optional JSON metadata as empty objects when listing sessions and messages', async () => {
    const fixture = setupIndex();
    const filePath = fixture.writeFixtureFile({
      name: 'malformed-optional-json.jsonl',
      content: 'metadata fixture\n',
      session: makeSessionFixture('bad-json-session', 'proj-a', {
        extraJson: '{not json'
      }),
      messages: [
        {
          ...makeMessageFixtures(1)[0],
          extraJson: 'null'
        },
        {
          ...makeMessageFixtures(2)[1],
          messageId: 'msg-array-extra',
          extraJson: '["unexpected"]'
        }
      ]
    }).filePath;

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const sessions = await index.listSessions('claude', 'proj-a');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].extra).toEqual({});
    expect(sessions[0].projectHint).toBe('proj-a');
    expect(sessions[0].tokens).toBeNull();

    fixture.rewriteFixtureFile(filePath, 'bad-json-session-updated\n', {
      session: makeSessionFixture('bad-json-session', 'proj-a', {
        usageJson: '{not json',
        extraJson: 'null'
      }),
      messages: [
        {
          ...makeMessageFixtures(1)[0],
          extraJson: 'null'
        },
        {
          ...makeMessageFixtures(2)[1],
          messageId: 'msg-array-extra',
          extraJson: '["unexpected"]'
        }
      ]
    });
    await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' });
    const malformedSessions = await index.listSessions('claude', 'proj-a');
    expect(malformedSessions).toHaveLength(1);
    expect(malformedSessions[0].tokens).toBeNull();
    expect(malformedSessions[0].extra).toEqual({});
    expect(malformedSessions[0].projectHint).toBe('proj-a');

    const page = await index.getMessagePage('claude', 'bad-json-session', { page: 1, limit: 10, order: 'asc' });
    expect(page.messages.map(message => message.extra)).toEqual([{}, {}]);
    expect(page.metadata.usage).toEqual({});
    expect(page.metadata.extra).toEqual({});
  });

  it('getRecentSessions returns limited recent sessions', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 's1.jsonl',
      content: 'a\n',
      session: makeSessionFixture('s1', 'proj-a', { updatedAt: 1000 }),
      messages: makeMessageFixtures(4)
    });
    fixture.writeFixtureFile({
      name: 's2.jsonl',
      content: 'b\n',
      session: makeSessionFixture('s2', 'proj-a', { updatedAt: 2000 }),
      messages: makeMessageFixtures(4)
    });
    fixture.writeFixtureFile({
      name: 's3.jsonl',
      content: 'c\n',
      session: makeSessionFixture('s3', 'proj-a', { updatedAt: 3000 }),
      messages: makeMessageFixtures(4)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const recent = await index.getRecentSessions('claude', 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].sessionId).toBe('s3');
    expect(recent[1].sessionId).toBe('s2');
  });

  it('stale-ok may return before complete while worker continues', async () => {
    vi.useFakeTimers();
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 'slow.jsonl',
      content: 'slow fixture\n',
      session: makeSessionFixture('s1', 'proj-a'),
      messages: makeMessageFixtures(2)
    });

    let resolveInventory;
    state.adapter.inventory.mockImplementation(async () => {
      await new Promise(resolve => {
        resolveInventory = resolve;
        setTimeout(resolve, 3000);
      });
      return fixture.descriptors.size ? Array.from(fixture.descriptors.values()).map((descriptor) => {
        const stat = fs.statSync(descriptor.filePath);
        return { ...descriptor, size: stat.size, mtimeMs: stat.mtimeMs };
      }) : [];
    });

    const promise = index.ensureSourceIndexed('claude', { consistency: 'stale-ok' });
    await vi.advanceTimersByTimeAsync(2500);
    await promise;
    resolveInventory();
    await vi.advanceTimersByTimeAsync(3000);
  });

  it('complete awaits the worker', async () => {
    vi.useFakeTimers();
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 'slow.jsonl',
      content: 'slow fixture\n',
      session: makeSessionFixture('s1', 'proj-a'),
      messages: makeMessageFixtures(2)
    });

    let resolved = false;
    state.adapter.inventory.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      resolved = true;
      return Array.from(fixture.descriptors.values()).map((descriptor) => {
        const stat = fs.statSync(descriptor.filePath);
        return { ...descriptor, size: stat.size, mtimeMs: stat.mtimeMs };
      });
    });

    const promise = index.ensureSourceIndexed('claude', { consistency: 'complete' });
    await vi.advanceTimersByTimeAsync(2999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(resolved).toBe(true);
  });

  it('index reopen preserves rows', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 's1.jsonl',
      content: 'persist fixture\n',
      session: makeSessionFixture('s1', 'proj-a'),
      messages: makeMessageFixtures(4)
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });
    index.closeSessionHistoryIndex();

    index = createSessionHistoryIndex({
      dbPath: fixture.dbPath,
      adapterRegistry: {
        claude: {
          inventory: vi.fn(async () => []),
          parse: vi.fn()
        }
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    const sessions = await index.listSessions('claude', 'proj-a');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('s1');
  });

  it('malformed new file is skipped', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 'bad.jsonl',
      content: 'bad fixture\n',
      session: makeSessionFixture('bad', 'proj-a'),
      messages: makeMessageFixtures(2)
    });
    fixture.writeFixtureFile({
      name: 'good.jsonl',
      content: 'good fixture\n',
      session: makeSessionFixture('good', 'proj-a'),
      messages: makeMessageFixtures(2)
    });
    const baseParse = state.adapter.parse.getMockImplementation();
    state.adapter.parse.mockImplementation(async (descriptor) => {
      const payload = fixture.descriptors.get(descriptor.filePath);
      if (payload?.sessionId === 'bad') {
        throw new Error('parse failure');
      }
      return baseParse(descriptor);
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    expect(await index.getSessionStatus('claude', 'bad')).toBeNull();
    expect(await index.getSessionStatus('claude', 'good')).not.toBeNull();
  });

  it('search finds matching content', async () => {
    const fixture = setupIndex();
    fixture.writeFixtureFile({
      name: 'search.jsonl',
      content: 'search fixture\n',
      session: makeSessionFixture('s1', 'proj-a'),
      messages: [
        {
          messageId: 'msg-0',
          role: 'user',
          type: 'user',
          subtype: null,
          content: 'Hello world this is a test message',
          timestamp: Date.now() - 60000,
          model: 'claude',
          provider: 'anthropic',
          userMessageNumber: 1,
          extraJson: null
        },
        {
          messageId: 'msg-1',
          role: 'assistant',
          type: 'assistant',
          subtype: null,
          content: 'I found the answer to your question',
          timestamp: Date.now(),
          model: 'claude',
          provider: 'anthropic',
          userMessageNumber: null,
          extraJson: null
        }
      ]
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });
    const results = await index.searchSessions('claude', 'hello');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sessionId).toBe('s1');
  });

  it('ftsDisabled fallback uses instr-based matching', async () => {
    const fixture = setupIndex({ ftsEnabledOverride: false });
    fixture.writeFixtureFile({
      name: 'search2.jsonl',
      content: 'search fixture\n',
      session: makeSessionFixture('s1', 'proj-a'),
      messages: [
        {
          messageId: 'msg-0',
          role: 'user',
          type: 'user',
          subtype: null,
          content: 'This contains SEARCHABLE text',
          timestamp: Date.now(),
          model: 'claude',
          provider: 'anthropic',
          userMessageNumber: 1,
          extraJson: null
        }
      ]
    });

    await index.ensureSourceIndexed('claude', { consistency: 'complete' });

    const results = await index.searchSessions('claude', 'searchable');
    expect(results.length).toBe(1);
    expect(results[0].sessionId).toBe('s1');
  });
});
describe('session-history-index runtime selection', () => {

  it('defaults to the platform runtime in child mode when no runtime or adapterRegistry is supplied', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevChild = process.env.CC_TOOL_SESSION_HISTORY_CHILD;
    process.env.NODE_ENV = 'production';
    process.env.CC_TOOL_SESSION_HISTORY_CHILD = '1';

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-default-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'runtime-default.jsonl');
    fs.writeFileSync(filePath, '{"type":"metadata"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const runtimeInventory = vi.fn(async () => [{
      filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sessionId: 'runtime-default',
      projectHint: 'runtime-default-project'
    }]);
    const runtimeParse = vi.fn(async () => ({
      session: makeSessionFixture('runtime-default', 'runtime-default-project'),
      messages: makeMessageFixtures(2)
    }));
    const originalGetPlatformRuntime = runtimeModule.getPlatformRuntime;
    runtimeModule.getPlatformRuntime = () => ({
      getDriver: vi.fn((source, capability) => {
        expect(source).toBe('claude');
        expect(capability).toBe('sessions');
        return { inventory: runtimeInventory, parse: runtimeParse };
      })
    });
    delete require.cache[require.resolve('../../../src/server/services/session-history-index.js')];
    const { createSessionHistoryIndex: createSessionHistoryIndexLocal } = require('../../../src/server/services/session-history-index.js');
    const workerRunner = vi.fn(async () => {
      throw new Error('worker runner should not be used when the child runtime is available');
    });
    const index = createSessionHistoryIndexLocal({
      dbPath,
      workerRunner,
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' });
      const row = index._getDb().prepare('SELECT COUNT(*) AS count FROM session_file WHERE source = ?').get('claude');
      expect(row.count).toBe(1);
    } finally {
      index.closeSessionHistoryIndex();
      runtimeModule.getPlatformRuntime = originalGetPlatformRuntime;
      delete require.cache[require.resolve('../../../src/server/services/session-history-index.js')];
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
      process.env.NODE_ENV = prevNodeEnv;
      if (prevChild === undefined) delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;
      else process.env.CC_TOOL_SESSION_HISTORY_CHILD = prevChild;
    }

    expect(runtimeInventory).toHaveBeenCalledTimes(1);
    expect(runtimeParse).toHaveBeenCalledTimes(1);
    expect(workerRunner).not.toHaveBeenCalled();
  });

  it('uses a runtime sessions driver when no explicit adapterRegistry is provided', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'runtime.jsonl');
    fs.writeFileSync(filePath, '{"type":"metadata"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const runtimeInventory = vi.fn(async () => [{
      filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sessionId: 'runtime',
      projectHint: 'runtime-project'
    }]);
    const runtimeParse = vi.fn(async () => ({
      session: makeSessionFixture('runtime', 'runtime-project'),
      messages: makeMessageFixtures(2)
    }));
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn((source, capability) => {
          expect(source).toBe('claude');
          expect(capability).toBe('sessions');
          return { inventory: runtimeInventory, parse: runtimeParse };
        })
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { consistency: 'complete' });
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }

    expect(runtimeInventory).toHaveBeenCalledTimes(1);
    expect(runtimeParse).toHaveBeenCalledTimes(1);
  });
  it('treats runtime undefined as omitted so production indexing uses the worker path', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-undefined-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const workerRunner = vi.fn(async () => {});
    const originalGetPlatformRuntime = runtimeModule.getPlatformRuntime;
    const getPlatformRuntime = vi.fn(() => ({
      getDriver: vi.fn(() => {
        throw new Error('default runtime should not be consulted before worker path');
      })
    }));
    runtimeModule.getPlatformRuntime = getPlatformRuntime;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalChild = process.env.CC_TOOL_SESSION_HISTORY_CHILD;
    process.env.NODE_ENV = 'production';
    delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;

    const index = createSessionHistoryIndex({
      dbPath,
      runtime: undefined,
      workerRunner,
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { consistency: 'complete', force: true });
    } finally {
      index.closeSessionHistoryIndex();
      runtimeModule.getPlatformRuntime = originalGetPlatformRuntime;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalChild === undefined) delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;
      else process.env.CC_TOOL_SESSION_HISTORY_CHILD = originalChild;
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }

    expect(workerRunner).toHaveBeenCalledWith('claude', dbPath, { force: true });
    expect(getPlatformRuntime).toHaveBeenCalledTimes(1);
  });

  it('ignores injected runtime in production-like environments so indexing uses the worker path', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-prod-ignored-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const workerRunner = vi.fn(async () => {});
    const runtimeInventory = vi.fn(async () => []);
    const originalNodeEnv = process.env.NODE_ENV;
    const originalChild = process.env.CC_TOOL_SESSION_HISTORY_CHILD;
    process.env.NODE_ENV = 'production';
    delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;

    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn(() => ({ inventory: runtimeInventory, parse: vi.fn() }))
      },
      workerRunner,
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { consistency: 'complete', force: true });
    } finally {
      index.closeSessionHistoryIndex();
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalChild === undefined) delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;
      else process.env.CC_TOOL_SESSION_HISTORY_CHILD = originalChild;
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }

    expect(workerRunner).toHaveBeenCalledWith('claude', dbPath, { force: true });
    expect(runtimeInventory).not.toHaveBeenCalled();
  });
  it('treats an unusable runtime object as omitted so production indexing uses the worker path', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-empty-object-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const workerRunner = vi.fn(async () => {});
    const originalNodeEnv = process.env.NODE_ENV;
    const originalChild = process.env.CC_TOOL_SESSION_HISTORY_CHILD;
    process.env.NODE_ENV = 'production';
    delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;

    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {},
      workerRunner,
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('demo-cli', { consistency: 'complete', force: true });
    } finally {
      index.closeSessionHistoryIndex();
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalChild === undefined) delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;
      else process.env.CC_TOOL_SESSION_HISTORY_CHILD = originalChild;
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }

    expect(workerRunner).toHaveBeenCalledWith('demo-cli', dbPath, { force: true });
  });


  it('rejects when runtime sessions driver resolution throws instead of falling back to the built-in adapter', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-resolve-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const runtimeError = new Error('resolve sessions driver failed');
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn((source, capability) => {
          expect(source).toBe('claude');
          expect(capability).toBe('sessions');
          throw runtimeError;
        })
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      const error = await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' })
        .then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.failure).toMatchObject({
        status: 'failed',
        platform: 'claude',
        capability: 'sessions',
        operation: 'resolve-driver',
        error: 'resolve sessions driver failed'
      });
      expect(error.cause).toBe(runtimeError);

      const row = index._getDb().prepare('SELECT last_error FROM source_state WHERE source = ?').get('claude');
      expect(row.last_error).toContain('resolve-driver');
      expect(row.last_error).toContain('resolve sessions driver failed');
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('returns unsupported custom session sources when no runtime sessions driver or adapter is available', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-unsupported-explicit-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn(() => null)
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      const error = await index.ensureSourceIndexed('demo-cli', { consistency: 'complete' })
        .then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.failure).toMatchObject({
        status: 'unsupported',
        platform: 'demo-cli',
        capability: 'sessions',
        operation: 'resolve-driver'
      });
      expect(error.failure.error).toContain('unsupported');

      const row = index._getDb().prepare('SELECT last_error, last_inventory_ms FROM source_state WHERE source = ?').get('demo-cli');
      expect(row).toBeTruthy();
      expect(row.last_inventory_ms).toBeNull();
      expect(row.last_error).toContain('unsupported');
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('treats typed unsupported runtime sessions results without an operation as explicit unsupported errors', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-unsupported-typed-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const sessionAdaptersPath = require.resolve('../../../src/server/services/session-history-adapters');
    const originalAdaptersCacheEntry = require.cache[sessionAdaptersPath];
    const legacyInventory = vi.fn(async () => {
      throw new Error('legacy adapter should not be used');
    });
    const legacyParse = vi.fn(async () => {
      throw new Error('legacy adapter should not be used');
    });

    require.cache[sessionAdaptersPath] = {
      id: sessionAdaptersPath,
      filename: sessionAdaptersPath,
      loaded: true,
      exports: {
        claude: { inventory: legacyInventory, parse: legacyParse },
        codex: { inventory: legacyInventory, parse: legacyParse },
        gemini: { inventory: legacyInventory, parse: legacyParse },
        omp: { inventory: legacyInventory, parse: legacyParse }
      }
    };

    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn((source, capability) => {
          expect(source).toBe('claude');
          expect(capability).toBe('sessions');
          return { status: 'unsupported', platform: 'demo-cli', capability: 'sessions' };
        })
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      const error = await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' })
        .then(() => null, (err) => err);

      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe('unsupported');
      expect(error.operation).toBe('resolve-driver');
      expect(error.context).toMatchObject({
        status: 'unsupported',
        platform: 'demo-cli',
        capability: 'sessions',
        operation: 'resolve-driver'
      });
      expect(error.failure).toMatchObject({
        status: 'unsupported',
        platform: 'demo-cli',
        capability: 'sessions',
        operation: 'resolve-driver'
      });
      expect(error.message).toContain('unsupported sessions');
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause.message).toContain('unsupported');
      expect(legacyInventory).not.toHaveBeenCalled();
      expect(legacyParse).not.toHaveBeenCalled();

      const row = index._getDb().prepare('SELECT last_error, last_inventory_ms FROM source_state WHERE source = ?').get('claude');
      expect(row).toBeTruthy();
      expect(row.last_inventory_ms).toBeNull();
      expect(row.last_error).toContain('unsupported');
    } finally {
      index.closeSessionHistoryIndex();
      if (originalAdaptersCacheEntry) {
        require.cache[sessionAdaptersPath] = originalAdaptersCacheEntry;
      } else {
        delete require.cache[sessionAdaptersPath];
      }
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });


  it('rejects unsupported custom session sources without a runtime driver or adapter', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-unsupported-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn(() => null)
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      const error = await index.ensureSourceIndexed('demo-cli', { consistency: 'complete' })
        .then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.failure).toMatchObject({
        status: 'unsupported',
        platform: 'demo-cli',
        capability: 'sessions',
        operation: 'resolve-driver'
      });
      expect(error.failure.error).toContain('unsupported');

      const row = index._getDb().prepare('SELECT last_error FROM source_state WHERE source = ?').get('demo-cli');
      expect(row.last_error).toContain('unsupported');
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });


  it('falls back to descriptor projectHint for generic direct runtime session payloads without project fields', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-hint-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'hinted.jsonl');
    fs.writeFileSync(filePath, '{"role":"user","content":"hello"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn((source, capability) => {
          expect(source).toBe('generic');
          expect(capability).toBe('sessions');
          return {
            inventory: vi.fn(async () => [{
              filePath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              sessionId: 'hinted',
              projectHint: 'descriptor-project'
            }]),
            parse: vi.fn(async () => ({
              sessionId: 'hinted',
              projectHint: '',
              projectName: '',
              updatedAt: stat.mtimeMs - 1,
              firstMessage: 'hello',
              messages: makeMessageFixtures(1, { userPrefix: 'Hinted user' })
            }))
          };
        })
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('generic', { consistency: 'complete' });
      const sessions = await index.listSessions('generic', 'descriptor-project');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionId: 'hinted',
        extra: expect.objectContaining({ projectHint: 'descriptor-project', mtimeMs: stat.mtimeMs }),
        projectHint: 'descriptor-project',
        projectName: 'descriptor-project',
        projectDisplayName: 'descriptor-project',
        firstMessage: 'hello',
        updatedAt: stat.mtimeMs
      });
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('returns descriptor projectHint separately from normalized projectName for direct runtime payloads', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-direct-hint-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'direct-hint.jsonl');
    fs.writeFileSync(filePath, '{"role":"user","content":"hello"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn((source, capability) => {
          expect(source).toBe('generic');
          expect(capability).toBe('sessions');
          return {
            inventory: vi.fn(async () => [{
              filePath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              sessionId: 'direct-hint',
              projectHint: 'descriptor-project'
            }]),
            parse: vi.fn(async () => ({
              sessionId: 'direct-hint',
              projectName: 'normalized-project',
              updatedAt: stat.mtimeMs - 1,
              firstMessage: 'hello',
              messages: makeMessageFixtures(1, { userPrefix: 'Direct hinted user' })
            }))
          };
        })
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('generic', { consistency: 'complete' });
      const sessions = await index.listSessions('generic', 'normalized-project');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionId: 'direct-hint',
        extra: expect.objectContaining({ projectHint: 'descriptor-project', mtimeMs: stat.mtimeMs }),
        projectHint: 'descriptor-project',
        projectName: 'normalized-project',
        projectDisplayName: 'normalized-project',
        firstMessage: 'hello',
        updatedAt: stat.mtimeMs
      });
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('accepts generic runtime sessions drivers that return a direct session payload', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-generic-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'generic.jsonl');
    fs.writeFileSync(filePath, '{"role":"user","content":"hello"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn((source, capability) => {
          expect(source).toBe('claude');
          expect(capability).toBe('sessions');
          return {
            inventory: vi.fn(async () => [{
              filePath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              sessionId: 'generic',
              projectHint: 'generic-project'
            }]),
            parse: vi.fn(async () => ({
              sessionId: 'generic',
              projectName: 'generic-project',
              firstMessage: 'hello',
              messages: makeMessageFixtures(1, { userPrefix: 'Generic user' })
            }))
          };
        })
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { consistency: 'complete' });
      const sessions = await index.listSessions('claude', 'generic-project');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('generic');
      expect(sessions[0].firstMessage).toBe('hello');
      expect(sessions[0].extra).toMatchObject({ projectHint: 'generic-project', mtimeMs: stat.mtimeMs });
      expect(sessions[0].updatedAt).toBe(stat.mtimeMs);
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('preserves descriptor project hints and mtimes for wrapped runtime payloads', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-wrapped-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'wrapped.jsonl');
    fs.writeFileSync(filePath, '{"role":"user","content":"hello"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn((source, capability) => {
          expect(source).toBe('claude');
          expect(capability).toBe('sessions');
          return {
            inventory: vi.fn(async () => [{
              filePath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              sessionId: 'wrapped',
              projectHint: 'descriptor-project'
            }]),
            parse: vi.fn(async () => ({
              session: {
                sessionId: 'wrapped',
                projectHint: '',
                projectName: '',
                updatedAt: stat.mtimeMs - 1,
                firstMessage: 'hello'
              },
              messages: makeMessageFixtures(1, { userPrefix: 'Wrapped user' })
            }))
          };
        })
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { consistency: 'complete' });
      const sessions = await index.listSessions('claude', 'descriptor-project');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionId: 'wrapped',
        extra: expect.objectContaining({ projectHint: 'descriptor-project', mtimeMs: stat.mtimeMs }),
        projectName: 'descriptor-project',
        projectDisplayName: 'descriptor-project',
        firstMessage: 'hello',
        updatedAt: stat.mtimeMs
      });
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('uses the runtime driver in-process instead of the worker runner only in NODE_ENV=test', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevChild = process.env.CC_TOOL_SESSION_HISTORY_CHILD;
    process.env.NODE_ENV = 'test';
    delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-worker-bypass-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'runtime-bypass.jsonl');
    fs.writeFileSync(filePath, '{"type":"metadata"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const workerRunner = vi.fn(async () => {
      throw new Error('worker runner should not be used for test runtime injection');
    });
    const runtimeInventory = vi.fn(async () => [{
      filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sessionId: 'runtime-bypass',
      projectHint: 'runtime-bypass-project'
    }]);
    const runtimeParse = vi.fn(async () => ({
      session: makeSessionFixture('runtime-bypass', 'runtime-bypass-project'),
      messages: makeMessageFixtures(2)
    }));
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn((source, capability) => {
          expect(source).toBe('claude');
          expect(capability).toBe('sessions');
          return { inventory: runtimeInventory, parse: runtimeParse };
        })
      },
      workerRunner,
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' });
      const sessions = await index.listSessions('claude', 'runtime-bypass-project');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('runtime-bypass');
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevChild === undefined) delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;
      else process.env.CC_TOOL_SESSION_HISTORY_CHILD = prevChild;
    }

    expect(workerRunner).not.toHaveBeenCalled();
    expect(runtimeInventory).toHaveBeenCalledTimes(1);
    expect(runtimeParse).toHaveBeenCalledTimes(1);
  });
  it('returns from a fresh source_state before resolving the runtime driver, while stale and forced paths still resolve it', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevChild = process.env.CC_TOOL_SESSION_HISTORY_CHILD;
    process.env.NODE_ENV = 'test';
    delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-fresh-state-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const runtime = {
      getDriver: vi.fn(() => {
        throw new Error('runtime driver should not be resolved for a fresh source_state');
      })
    };
    const index = createSessionHistoryIndex({
      dbPath,
      runtime,
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      index._getDb().prepare(
        'INSERT INTO source_state(source, last_inventory_ms, last_error) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET last_inventory_ms = excluded.last_inventory_ms, last_error = excluded.last_error'
      ).run('claude', Date.now(), null);

      await index.ensureSourceIndexed('claude', { consistency: 'complete' });
      expect(runtime.getDriver).not.toHaveBeenCalled();

      index._getDb().prepare(
        'INSERT INTO source_state(source, last_inventory_ms, last_error) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET last_inventory_ms = excluded.last_inventory_ms, last_error = excluded.last_error'
      ).run('claude', Date.now() - 60000, null);

      await expect(index.ensureSourceIndexed('claude', { consistency: 'complete' }))
        .rejects.toThrow('runtime driver should not be resolved for a fresh source_state');
      expect(runtime.getDriver).toHaveBeenCalledTimes(1);

      await expect(index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' }))
        .rejects.toThrow('runtime driver should not be resolved for a fresh source_state');
      expect(runtime.getDriver).toHaveBeenCalledTimes(2);
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevChild === undefined) delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;
      else process.env.CC_TOOL_SESSION_HISTORY_CHILD = prevChild;
    }
  });


  it('records typed runtime inventory failures without advancing last_inventory_ms', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-failure-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'runtime-failure.jsonl');
    fs.writeFileSync(filePath, '{"type":"metadata"}\n', 'utf8');
    fs.statSync(filePath);
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn(() => ({
          inventory: vi.fn(async () => ({
            status: 'failed',
            platform: 'test-platform',
            capability: 'sessions',
            operation: 'inventory',
            error: 'missing'
          })),
          parse: vi.fn(async () => ({
            session: makeSessionFixture('runtime-failure', 'runtime-failure-project'),
            messages: makeMessageFixtures(2)
          }))
        }))
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      const error = await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' })
        .then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.platform).toBe('test-platform');
      expect(error.capability).toBe('sessions');
      expect(error.operation).toBe('inventory');
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause.message).toContain('missing');
      const sessionRow = index._getDb().prepare('SELECT COUNT(*) AS count FROM session_file WHERE source = ? AND session_id = ?').get('claude', 'runtime-failure');
      expect(sessionRow.count).toBe(0);

      const row = index._getDb().prepare('SELECT last_error, last_inventory_ms FROM source_state WHERE source = ?').get('claude');
      expect(row).toBeTruthy();
      expect(row.last_inventory_ms).toBeNull();
      expect(row.last_error).toContain('test-platform');
      expect(row.last_error).toContain('sessions');
      expect(row.last_error).toContain('inventory');
      expect(row.last_error).toContain('missing');
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('keeps last_inventory_ms fresh after ordinary parse failures during a completed inventory pass', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-parse-failure-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const goodPath = path.join(rootDir, 'good.jsonl');
    const badPath = path.join(rootDir, 'bad.jsonl');
    fs.writeFileSync(goodPath, '{"type":"metadata"}\n', 'utf8');
    fs.writeFileSync(badPath, '{"type":"metadata"}\n', 'utf8');
    const goodStat = fs.statSync(goodPath);
    const badStat = fs.statSync(badPath);
    const inventory = vi.fn(async () => ([
      { filePath: goodPath, size: goodStat.size, mtimeMs: goodStat.mtimeMs, sessionId: 'good', projectHint: 'good-project' },
      { filePath: badPath, size: badStat.size, mtimeMs: badStat.mtimeMs, sessionId: 'bad', projectHint: 'bad-project' }
    ]));
    const parse = vi.fn(async (descriptor) => {
      if (descriptor.filePath === badPath) {
        throw new Error('parse failure');
      }
      return {
        session: makeSessionFixture('good', 'good-project'),
        messages: makeMessageFixtures(2)
      };
    });
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn(() => ({ inventory, parse }))
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' });
      await index.ensureSourceIndexed('claude', { consistency: 'complete' });

      expect(inventory).toHaveBeenCalledTimes(1);
      const row = index._getDb().prepare('SELECT last_error, last_inventory_ms FROM source_state WHERE source = ?').get('claude');
      expect(row).toBeTruthy();
      expect(row.last_inventory_ms).not.toBeNull();
      expect(row.last_error).toContain('parse failure');
      expect(row.last_error).toContain(badPath);
      expect(await index.getSessionStatus('claude', 'good')).not.toBeNull();
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('rejects typed runtime parse failures with platform context before destructuring payloads', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-parse-typed-failure-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'typed-failure.jsonl');
    fs.writeFileSync(filePath, '{"type":"metadata"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const parseFailure = {
      status: 'failed',
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'parse',
      error: 'descriptor parse failed'
    };
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn(() => ({
          inventory: vi.fn(async () => [{
            filePath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sessionId: 'typed-failure',
            projectHint: 'typed-project'
          }]),
          parse: vi.fn(async () => parseFailure)
        }))
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      const error = await index.ensureSourceIndexed('demo-cli', { force: true, consistency: 'complete' })
        .then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.platform).toBe('demo-cli');
      expect(error.capability).toBe('sessions');
      expect(error.operation).toBe('parse');
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause.message).toContain('descriptor parse failed');
      expect(error.failure).toMatchObject(parseFailure);

      const row = index._getDb().prepare('SELECT last_error, last_inventory_ms FROM source_state WHERE source = ?').get('demo-cli');
      expect(row.last_inventory_ms).toBeNull();
      expect(row.last_error).toContain('parse');
      expect(row.last_error).toContain('descriptor parse failed');
      const sessionRow = index._getDb().prepare('SELECT COUNT(*) AS count FROM session_file WHERE source = ?').get('demo-cli');
      expect(sessionRow.count).toBe(0);
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('retries a non-force inventory after a typed failure leaves the source stale', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-runtime-retry-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const filePath = path.join(rootDir, 'runtime-retry.jsonl');
    fs.writeFileSync(filePath, '{"type":"metadata"}\n', 'utf8');
    const stat = fs.statSync(filePath);
    const inventory = vi.fn()
      .mockResolvedValueOnce({
        status: 'failed',
        platform: 'test-platform',
        capability: 'sessions',
        operation: 'inventory',
        error: 'missing'
      })
      .mockResolvedValueOnce([{ filePath, size: stat.size, mtimeMs: stat.mtimeMs, sessionId: 'retry', projectHint: 'retry-project' }]);
    const parse = vi.fn(async () => ({
      session: makeSessionFixture('retry', 'retry-project'),
      messages: makeMessageFixtures(2)
    }));
    const index = createSessionHistoryIndex({
      dbPath,
      runtime: {
        getDriver: vi.fn(() => ({ inventory, parse }))
      },
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { force: true, consistency: 'complete' }).catch(() => {});
      await index.ensureSourceIndexed('claude', { consistency: 'complete' });

      expect(inventory).toHaveBeenCalledTimes(2);
      expect(await index.getSessionStatus('claude', 'retry')).not.toBeNull();
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('keeps an explicit adapterRegistry ahead of runtime sessions drivers and worker runners', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevChild = process.env.CC_TOOL_SESSION_HISTORY_CHILD;
    process.env.NODE_ENV = 'production';
    delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-session-explicit-'));
    const dbPath = path.join(rootDir, 'history.sqlite');
    const explicitInventory = vi.fn(async () => []);
    const explicitParse = vi.fn(async () => ({ session: null, messages: [] }));
    const runtimeInventory = vi.fn(async () => []);
    const runtimeParse = vi.fn(async () => ({ session: null, messages: [] }));
    const workerRunner = vi.fn(async () => {
      throw new Error('worker runner should not be used when adapterRegistry is supplied');
    });
    const index = createSessionHistoryIndex({
      dbPath,
      adapterRegistry: { claude: { inventory: explicitInventory, parse: explicitParse } },
      runtime: {
        getDriver: vi.fn(() => ({ inventory: runtimeInventory, parse: runtimeParse }))
      },
      workerRunner,
      ftsEnabledOverride: false
    });

    try {
      await index.ensureSourceIndexed('claude', { consistency: 'complete' });
    } finally {
      index.closeSessionHistoryIndex();
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_) {}
      process.env.NODE_ENV = prevNodeEnv;
      if (prevChild === undefined) delete process.env.CC_TOOL_SESSION_HISTORY_CHILD;
      else process.env.CC_TOOL_SESSION_HISTORY_CHILD = prevChild;
    }

    expect(explicitInventory).toHaveBeenCalledTimes(1);
    expect(explicitParse).not.toHaveBeenCalled();
    expect(workerRunner).not.toHaveBeenCalled();
    expect(runtimeInventory).not.toHaveBeenCalled();
    expect(runtimeParse).not.toHaveBeenCalled();
  });
});