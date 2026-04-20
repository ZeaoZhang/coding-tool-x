const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let testDir;
let homeDir;
let geminiDir;
let geminiSessions;

function hashPath(filePath) {
  return crypto.createHash('sha256').update(filePath).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createGeminiSession(projectHash, fileName, session) {
  const sessionPath = path.join(geminiDir, 'tmp', projectHash, 'chats', fileName);
  writeJson(sessionPath, session);
  return sessionPath;
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-sessions-service-'));
  homeDir = path.join(testDir, 'home');
  geminiDir = path.join(testDir, '.gemini');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(geminiDir, { recursive: true });

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      HOME_DIR: homeDir
    }
  };

  require.cache[require.resolve('../../../src/server/services/gemini-config')] = {
    id: require.resolve('../../../src/server/services/gemini-config'),
    filename: require.resolve('../../../src/server/services/gemini-config'),
    loaded: true,
    exports: {
      getGeminiDir: vi.fn(() => geminiDir)
    }
  };

  delete require.cache[require.resolve('../../../src/server/services/gemini-sessions')];
  geminiSessions = require('../../../src/server/services/gemini-sessions');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/gemini-sessions',
    '../../../src/config/paths',
    '../../../src/server/services/gemini-config'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('gemini-sessions project discovery and querying', () => {
  test('resolves project paths from hashes and builds project summaries', () => {
    const projectPath = path.join(homeDir, 'workspace', 'demo-app');
    fs.mkdirSync(projectPath, { recursive: true });
    const resolvedHash = hashPath(projectPath);
    const unresolvedHash = hashPath('/external/demo-app');

    createGeminiSession(resolvedHash, 'session-2026-03-17T10-00-aaaa1111.json', {
      sessionId: 'resolved-session',
      projectHash: resolvedHash,
      startTime: '2026-03-17T09:00:00.000Z',
      lastUpdated: '2026-03-17T10:00:00.000Z',
      messages: [{ type: 'user', content: 'resolved' }]
    });
    createGeminiSession(unresolvedHash, 'session-2026-03-18T10-00-bbbb2222.json', {
      sessionId: 'unresolved-session',
      projectHash: unresolvedHash,
      startTime: '2026-03-18T09:00:00.000Z',
      lastUpdated: '2026-03-18T10:00:00.000Z',
      messages: [{ type: 'user', content: 'unresolved' }]
    });

    expect(geminiSessions.getProjectPath(resolvedHash)).toBe(projectPath);
    expect(geminiSessions.getProjectPath(unresolvedHash)).toBeNull();
    expect(geminiSessions.getProjects()).toEqual([
      {
        name: unresolvedHash,
        displayName: `Project ${unresolvedHash.substring(0, 8)}`,
        path: null,
        sessionCount: 1,
        lastUpdated: '2026-03-18T10:00:00.000Z',
        source: 'gemini'
      },
      {
        name: resolvedHash,
        displayName: 'demo-app',
        path: projectPath,
        sessionCount: 1,
        lastUpdated: '2026-03-17T10:00:00.000Z',
        source: 'gemini'
      }
    ]);
  });

  test('reads, normalizes, searches, and returns recent Gemini sessions', () => {
    const projectPath = path.join(homeDir, 'workspace', 'notes-app');
    fs.mkdirSync(projectPath, { recursive: true });
    const projectHash = hashPath(projectPath);

    const olderPath = createGeminiSession(projectHash, 'session-2026-03-17T09-00-aaaa1111.json', {
      sessionId: 'older-session',
      projectHash,
      startTime: '2026-03-17T09:00:00.000Z',
      lastUpdated: '2026-03-17T09:05:00.000Z',
      messages: [
        {
          type: 'user',
          content: 'Find the needle in this message',
          timestamp: '2026-03-17T09:00:00.000Z'
        },
        {
          type: 'assistant',
          content: 'Needle summary',
          timestamp: '2026-03-17T09:01:00.000Z',
          model: 'gemini-2.5-pro',
          tokens: { total: 40, input: 20, output: 20 }
        }
      ]
    });
    const newerPath = createGeminiSession(projectHash, 'session-2026-03-18T09-00-bbbb2222.json', {
      sessionId: 'newer-session',
      projectHash,
      startTime: '2026-03-18T09:00:00.000Z',
      lastUpdated: '2026-03-18T09:05:00.000Z',
      messages: [
        {
          type: 'user',
          content: 'Another message without the keyword',
          timestamp: '2026-03-18T09:00:00.000Z'
        }
      ]
    });

    const allSessions = geminiSessions.getAllSessions();
    expect(allSessions.map((session) => session.sessionId)).toEqual(['newer-session', 'older-session']);
    expect(allSessions[1]).toEqual(expect.objectContaining({
      filePath: olderPath,
      firstMessage: 'Find the needle in this message',
      tokens: 40,
      model: 'gemini-2.5-pro',
      source: 'gemini'
    }));
    expect(allSessions[1].cost).toBeCloseTo(0.000125, 8);

    expect(geminiSessions.getProjectSessions(projectHash)).toEqual([
      {
        sessionId: 'newer-session',
        mtime: expect.any(String),
        size: fs.statSync(newerPath).size,
        filePath: newerPath,
        gitBranch: null,
        firstMessage: 'Another message without the keyword',
        forkedFrom: null,
        source: 'gemini',
        tokens: 0,
        cost: 0,
        model: 'gemini-2.5-pro',
        projectHash,
        projectName: projectHash
      },
      {
        sessionId: 'older-session',
        mtime: expect.any(String),
        size: fs.statSync(olderPath).size,
        filePath: olderPath,
        gitBranch: null,
        firstMessage: 'Find the needle in this message',
        forkedFrom: null,
        source: 'gemini',
        tokens: 40,
        cost: expect.any(Number),
        model: 'gemini-2.5-pro',
        projectHash,
        projectName: projectHash
      }
    ]);
    expect(geminiSessions.getRecentSessions(1)).toEqual([
      expect.objectContaining({
        sessionId: 'newer-session',
        projectHash
      })
    ]);
    expect(geminiSessions.getSessionById('older-session')).toEqual(expect.objectContaining({
      sessionId: 'older-session',
      filePath: olderPath,
      source: 'gemini'
    }));
    expect(geminiSessions.getSession('older-session')).toEqual(expect.objectContaining({
      sessionId: 'older-session',
      projectHash
    }));
    expect(geminiSessions.searchSessions('needle', 5)).toEqual([
      {
        sessionId: 'older-session',
        projectHash,
        firstMessage: 'Find the needle in this message',
        lastUpdated: '2026-03-17T09:05:00.000Z',
        matches: [
          {
            messageIndex: 0,
            role: 'user',
            context: '... the needle in t...',
            timestamp: '2026-03-17T09:00:00.000Z'
          },
          {
            messageIndex: 1,
            role: 'assistant',
            context: 'Needle summ...',
            timestamp: '2026-03-17T09:01:00.000Z'
          }
        ],
        matchCount: 2,
        source: 'gemini'
      }
    ]);
  });

  test('forks, deletes, and counts sessions and projects', () => {
    const projectPath = path.join(homeDir, 'workspace', 'fork-app');
    fs.mkdirSync(projectPath, { recursive: true });
    const projectHash = hashPath(projectPath);

    const originalPath = createGeminiSession(projectHash, 'session-2026-03-19T09-00-aaaa1111.json', {
      sessionId: 'source-session',
      projectHash,
      startTime: '2026-03-19T09:00:00.000Z',
      lastUpdated: '2026-03-19T09:05:00.000Z',
      messages: [
        {
          type: 'user',
          content: 'fork me',
          timestamp: '2026-03-19T09:00:00.000Z'
        }
      ]
    });

    vi.spyOn(require('crypto'), 'randomUUID').mockReturnValue('forked-session-id');
    vi.spyOn(require('crypto'), 'randomBytes').mockReturnValue(Buffer.from('abcd1234', 'hex'));

    const beforeCounts = geminiSessions.getProjectAndSessionCounts();
    const forked = geminiSessions.forkSession('source-session');
    const forkedSession = JSON.parse(fs.readFileSync(forked.filePath, 'utf8'));
    const deleted = geminiSessions.deleteSession('source-session');
    const afterDeleteCounts = geminiSessions.getProjectAndSessionCounts();
    const removedProject = geminiSessions.deleteProject(projectHash);
    const finalCounts = geminiSessions.getProjectAndSessionCounts();

    expect(beforeCounts).toEqual({ projectCount: 1, sessionCount: 1 });
    expect(forked).toEqual({
      success: true,
      sessionId: 'forked-session-id',
      filePath: forked.filePath,
      forkedFrom: 'source-session',
      alias: null,
      afterUserMessageNumber: null
    });
    expect(forkedSession).toEqual(expect.objectContaining({
      sessionId: 'forked-session-id',
      forkedFrom: 'source-session'
    }));
    expect(path.dirname(forked.filePath)).toBe(path.dirname(originalPath));
    expect(deleted).toEqual({ success: true, sessionId: 'source-session' });
    expect(fs.existsSync(originalPath)).toBe(false);
    expect(afterDeleteCounts).toEqual({ projectCount: 1, sessionCount: 1 });
    expect(removedProject).toEqual({ success: true, projectHash });
    expect(finalCounts).toEqual({ projectCount: 0, sessionCount: 0 });
  });

  test('fork can keep the selected user turn with assistant output and assign an alias', () => {
    const projectPath = path.join(homeDir, 'workspace', 'fork-range-app');
    fs.mkdirSync(projectPath, { recursive: true });
    const projectHash = hashPath(projectPath);

    createGeminiSession(projectHash, 'session-2026-03-20T09-00-bbbb2222.json', {
      sessionId: 'range-source',
      projectHash,
      startTime: '2026-03-20T09:00:00.000Z',
      lastUpdated: '2026-03-20T09:05:00.000Z',
      messages: [
        { type: 'user', content: 'Question 1', timestamp: '2026-03-20T09:00:00.000Z' },
        { type: 'assistant', content: 'Answer 1', timestamp: '2026-03-20T09:00:10.000Z' },
        { type: 'user', content: 'Question 2', timestamp: '2026-03-20T09:01:00.000Z' }
      ]
    });

    const setAliasMock = vi.fn();
    require.cache[require.resolve('../../../src/server/services/alias')] = {
      id: require.resolve('../../../src/server/services/alias'),
      filename: require.resolve('../../../src/server/services/alias'),
      loaded: true,
      exports: { setAlias: setAliasMock, loadAliases: vi.fn(() => ({})) }
    };

    vi.spyOn(require('crypto'), 'randomUUID').mockReturnValue('range-fork-id');
    vi.spyOn(require('crypto'), 'randomBytes').mockReturnValue(Buffer.from('abcd5678', 'hex'));

    const forked = geminiSessions.forkSession('range-source', {
      afterUserMessageNumber: 1,
      alias: 'fork-range'
    });
    const forkedSession = JSON.parse(fs.readFileSync(forked.filePath, 'utf8'));

    expect(forked).toEqual({
      success: true,
      sessionId: 'range-fork-id',
      filePath: forked.filePath,
      forkedFrom: 'range-source',
      alias: 'fork-range',
      afterUserMessageNumber: 1
    });
    expect(forkedSession.messages).toEqual([
      expect.objectContaining({ type: 'user', content: 'Question 1' }),
      expect.objectContaining({ type: 'assistant', content: 'Answer 1' })
    ]);
    expect(setAliasMock).toHaveBeenCalledWith('range-fork-id', 'fork-range');
  });
});
