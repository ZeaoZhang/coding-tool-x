/**
 * Tests for src/server/services/sessions.js
 *
 * Strategy: use a real tmpdir for filesystem I/O so getProjectOrder,
 * saveProjectOrder, getForkRelations, saveForkRelations, getProjects, and
 * deleteProject can be exercised against real files/directories.
 * All heavy non-fs dependencies are stubbed via require.cache.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Resolve dependency paths once at module load time
const PATHS_PATH         = require.resolve('../../../src/config/paths');
const SESSION_UTIL_PATH  = require.resolve('../../../src/utils/session');
const ALIAS_PATH         = require.resolve('../../../src/server/services/alias');
const SESSION_CACHE_PATH = require.resolve('../../../src/server/services/session-cache');
const ENHANCED_CACHE_PATH = require.resolve('../../../src/server/services/enhanced-cache');
const SESSIONS_PATH      = require.resolve('../../../src/server/services/sessions');
const GLOBAL_CACHE_DELETE = vi.fn();
const SET_ALIAS_MOCK = vi.fn();

// Per-test workspace
let testDir;
let projectsDir;
let orderFile;
let forkFile;
let sessionOrderFile;

beforeEach(() => {
  testDir          = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-test-'));
  projectsDir      = path.join(testDir, 'projects');
  orderFile        = path.join(testDir, 'project-order.json');
  forkFile         = path.join(testDir, 'fork-relations.json');
  sessionOrderFile = path.join(testDir, 'session-order.json');

  fs.mkdirSync(projectsDir, { recursive: true });

  // Stub paths
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
    exports: {
      PATHS: {
        base:         testDir,
        projectOrder: orderFile,
        forkRelations: forkFile,
        sessionOrder:  sessionOrderFile,
      },
      NATIVE_PATHS: {
        claude: { projects: projectsDir },
        codex:  { config: path.join(testDir, 'codex', 'codex.toml') },
        gemini: { env:    path.join(testDir, 'gemini', '.env') },
      },
    },
  };

  require.cache[SESSION_UTIL_PATH] = {
    id: SESSION_UTIL_PATH, filename: SESSION_UTIL_PATH, loaded: true,
    exports: {
      getAllSessions:       vi.fn(() => []),
      parseSessionInfoFast: vi.fn(() => null),
    },
  };

  require.cache[ALIAS_PATH] = {
    id: ALIAS_PATH, filename: ALIAS_PATH, loaded: true,
    exports: { loadAliases: vi.fn(() => ({})), setAlias: SET_ALIAS_MOCK },
  };

  require.cache[SESSION_CACHE_PATH] = {
    id: SESSION_CACHE_PATH, filename: SESSION_CACHE_PATH, loaded: true,
    exports: {
      getCachedProjects:       vi.fn(),
      setCachedProjects:       vi.fn(),
      invalidateProjectsCache: vi.fn(),
      checkHasMessagesCache:   vi.fn(),
      rememberHasMessages:     vi.fn(),
    },
  };

  require.cache[ENHANCED_CACHE_PATH] = {
    id: ENHANCED_CACHE_PATH, filename: ENHANCED_CACHE_PATH, loaded: true,
    exports: {
      globalCache: { get: vi.fn(), set: vi.fn(), delete: GLOBAL_CACHE_DELETE },
      CacheKeys:   { PROJECTS: 'p:', SESSIONS: 's:', COUNTS: 'c:', HAS_MESSAGES: 'hm:' },
    },
  };

  // Force fresh require of sessions module with new stubs
  GLOBAL_CACHE_DELETE.mockReset();
  SET_ALIAS_MOCK.mockReset();
  delete require.cache[SESSIONS_PATH];
});

afterEach(() => {
  delete require.cache[SESSIONS_PATH];
  // Clean up tmpdir
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
});

// ── getProjectOrder ───────────────────────────────────────────────────────────

describe('getProjectOrder', () => {
  test('returns [] when order file does not exist', () => {
    const { getProjectOrder } = require('../../../src/server/services/sessions');
    expect(getProjectOrder({})).toEqual([]);
  });

  test('returns parsed array from valid order file', () => {
    fs.writeFileSync(orderFile, JSON.stringify(['proj-a', 'proj-b']), 'utf8');
    const { getProjectOrder } = require('../../../src/server/services/sessions');
    expect(getProjectOrder({})).toEqual(['proj-a', 'proj-b']);
  });

  test('returns [] when order file contains invalid JSON', () => {
    fs.writeFileSync(orderFile, '<<<not json>>>', 'utf8');
    const { getProjectOrder } = require('../../../src/server/services/sessions');
    expect(getProjectOrder({})).toEqual([]);
  });
});

// ── saveProjectOrder ──────────────────────────────────────────────────────────

describe('saveProjectOrder', () => {
  test('writes JSON to order file and creates parent dir', () => {
    // Use a nested path that does not yet exist
    const nestedOrder = path.join(testDir, 'nested', 'order.json');
    require.cache[PATHS_PATH].exports.PATHS.projectOrder = nestedOrder;
    delete require.cache[SESSIONS_PATH];

    const { saveProjectOrder, getProjectOrder } = require('../../../src/server/services/sessions');
    saveProjectOrder({}, ['x', 'y', 'z']);

    expect(fs.existsSync(nestedOrder)).toBe(true);
    const written = JSON.parse(fs.readFileSync(nestedOrder, 'utf8'));
    expect(written).toEqual(['x', 'y', 'z']);
  });

  test('round-trips through getProjectOrder', () => {
    const { saveProjectOrder, getProjectOrder } = require('../../../src/server/services/sessions');
    saveProjectOrder({}, ['alpha', 'beta']);
    expect(getProjectOrder({})).toEqual(['alpha', 'beta']);
  });
});

// ── getForkRelations ──────────────────────────────────────────────────────────

describe('getForkRelations', () => {
  test('returns {} when fork file does not exist', () => {
    const { getForkRelations } = require('../../../src/server/services/sessions');
    expect(getForkRelations()).toEqual({});
  });

  test('returns parsed object from valid fork file', () => {
    const relations = { 'new-id': 'old-id' };
    fs.writeFileSync(forkFile, JSON.stringify(relations), 'utf8');
    const { getForkRelations } = require('../../../src/server/services/sessions');
    expect(getForkRelations()).toEqual(relations);
  });

  test('returns {} when fork file contains invalid JSON', () => {
    fs.writeFileSync(forkFile, 'bad json', 'utf8');
    const { getForkRelations } = require('../../../src/server/services/sessions');
    expect(getForkRelations()).toEqual({});
  });
});

// ── saveForkRelations ─────────────────────────────────────────────────────────

describe('saveForkRelations', () => {
  test('writes relations JSON to fork file', () => {
    const { saveForkRelations } = require('../../../src/server/services/sessions');
    saveForkRelations({ 'sid-new': 'sid-old' });

    const written = JSON.parse(fs.readFileSync(forkFile, 'utf8'));
    expect(written).toEqual({ 'sid-new': 'sid-old' });
  });

  test('round-trips through getForkRelations', () => {
    const { saveForkRelations, getForkRelations } = require('../../../src/server/services/sessions');
    saveForkRelations({ a: 'b', c: 'd' });
    expect(getForkRelations()).toEqual({ a: 'b', c: 'd' });
  });
});

// ── getProjects ───────────────────────────────────────────────────────────────

describe('getProjects', () => {
  test('returns [] when projects directory is empty', async () => {
    const { getProjects } = require('../../../src/server/services/sessions');
    const result = await getProjects({ projectsDir });
    expect(result).toEqual([]);
  });

  test('returns subdirectory names', async () => {
    fs.mkdirSync(path.join(projectsDir, 'proj-one'));
    fs.mkdirSync(path.join(projectsDir, 'proj-two'));
    // A file should not be included
    fs.writeFileSync(path.join(projectsDir, 'not-a-dir.txt'), '', 'utf8');

    const { getProjects } = require('../../../src/server/services/sessions');
    const result = await getProjects({ projectsDir });
    expect(result.sort()).toEqual(['proj-one', 'proj-two']);
  });

  test('uses Claude native projects dir when config.projectsDir is absent', async () => {
    fs.mkdirSync(path.join(projectsDir, 'native-proj'));

    const { getProjects } = require('../../../src/server/services/sessions');
    const result = await getProjects({});
    expect(result).toEqual(['native-proj']);
  });

  test('returns [] when projects directory does not exist', async () => {
    const { getProjects } = require('../../../src/server/services/sessions');
    const result = await getProjects({ projectsDir: path.join(testDir, 'nonexistent') });
    expect(result).toEqual([]);
  });
});

// ── deleteProject ─────────────────────────────────────────────────────────────

describe('deleteProject', () => {
  test('removes project directory recursively', () => {
    const projDir = path.join(projectsDir, 'to-delete');
    fs.mkdirSync(projDir);
    fs.writeFileSync(path.join(projDir, 'session.jsonl'), '', 'utf8');

    const { deleteProject } = require('../../../src/server/services/sessions');
    const result = deleteProject({ projectsDir }, 'to-delete');

    expect(result.success).toBe(true);
    expect(fs.existsSync(projDir)).toBe(false);
  });

  test('uses Claude native projects dir when deleting without config.projectsDir', () => {
    const projDir = path.join(projectsDir, 'native-delete');
    fs.mkdirSync(projDir);

    const { deleteProject } = require('../../../src/server/services/sessions');
    const result = deleteProject({}, 'native-delete');

    expect(result.success).toBe(true);
    expect(fs.existsSync(projDir)).toBe(false);
  });

  test('throws when project does not exist', () => {
    const { deleteProject } = require('../../../src/server/services/sessions');
    expect(() => deleteProject({ projectsDir }, 'ghost-project')).toThrow('Project not found');
  });

  test('removes project from order file when present', () => {
    // Create project dir and pre-populate order file
    const projDir = path.join(projectsDir, 'ordered-proj');
    fs.mkdirSync(projDir);
    fs.writeFileSync(orderFile, JSON.stringify(['ordered-proj', 'other-proj']), 'utf8');

    const { deleteProject, getProjectOrder } = require('../../../src/server/services/sessions');
    deleteProject({ projectsDir }, 'ordered-proj');

    const remaining = getProjectOrder({});
    expect(remaining).not.toContain('ordered-proj');
    expect(remaining).toContain('other-proj');
  });
});

describe('forkSession', () => {
  test('copies a session, keeps the selected user turn with following assistant output, stores alias, and invalidates session cache', () => {
    const projectName = 'demo-project';
    const projectDir = path.join(projectsDir, projectName);
    fs.mkdirSync(projectDir, { recursive: true });

    const sourcePath = path.join(projectDir, 'source-session.jsonl');
    fs.writeFileSync(sourcePath, [
      JSON.stringify({ type: 'summary', summary: 'summary' }),
      JSON.stringify({ type: 'user', message: { content: 'Question 1' }, timestamp: '2025-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', message: { content: 'Answer 1' }, timestamp: '2025-01-01T00:00:01.000Z' }),
      JSON.stringify({ type: 'user', message: { content: 'Question 2' }, timestamp: '2025-01-01T00:00:02.000Z' }),
      JSON.stringify({ type: 'assistant', message: { content: 'Answer 2' }, timestamp: '2025-01-01T00:00:03.000Z' }),
      ''
    ].join('\n'), 'utf8');

    const randomUuidSpy = vi.spyOn(require('crypto'), 'randomUUID').mockReturnValue('forked-session-id');

    const { forkSession, getForkRelations } = require('../../../src/server/services/sessions');
    const result = forkSession(
      { projectsDir },
      projectName,
      'source-session',
      {
        afterUserMessageNumber: 1,
        alias: 'fork-alias'
      }
    );

    const forkedPath = path.join(projectDir, 'forked-session-id.jsonl');
    const forkedLines = fs.readFileSync(forkedPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));

    expect(result).toEqual({
      newSessionId: 'forked-session-id',
      forkedFrom: 'source-session',
      alias: 'fork-alias',
      afterUserMessageNumber: 1
    });
    expect(forkedLines).toHaveLength(3);
    expect(forkedLines[1]).toEqual(expect.objectContaining({
      type: 'user',
      message: expect.objectContaining({
        content: 'Question 1'
      })
    }));
    expect(forkedLines[2]).toEqual(expect.objectContaining({
      type: 'assistant',
      message: expect.objectContaining({
        content: 'Answer 1'
      })
    }));
    expect(getForkRelations()).toEqual({ 'forked-session-id': 'source-session' });
    expect(SET_ALIAS_MOCK).toHaveBeenCalledWith('forked-session-id', 'fork-alias');
    expect(GLOBAL_CACHE_DELETE).toHaveBeenCalledWith('s:demo-project');
    randomUuidSpy.mockRestore();
  });

  test('throws when the requested user message index does not exist', () => {
    const projectName = 'demo-project';
    const projectDir = path.join(projectsDir, projectName);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'source-session.jsonl'),
      `${JSON.stringify({ type: 'user', message: { content: 'Only question' } })}\n`,
      'utf8'
    );

    const { forkSession } = require('../../../src/server/services/sessions');

    expect(() => forkSession(
      { projectsDir },
      projectName,
      'source-session',
      { afterUserMessageNumber: 2 }
    )).toThrow('afterUserMessageNumber 2 exceeds available user messages (1)');
  });

  test('preserves CRLF line endings when truncating fork content', () => {
    const projectName = 'windows-project';
    const projectDir = path.join(projectsDir, projectName);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'windows-session.jsonl'),
      [
        JSON.stringify({ type: 'summary', summary: 'summary' }),
        JSON.stringify({ type: 'user', message: { content: 'Question 1' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Answer 1' } })
      ].join('\r\n') + '\r\n',
      'utf8'
    );

    const randomUuidSpy = vi.spyOn(require('crypto'), 'randomUUID').mockReturnValue('windows-fork-id');
    const { forkSession } = require('../../../src/server/services/sessions');

    forkSession(
      { projectsDir },
      projectName,
      'windows-session',
      { afterUserMessageNumber: 1 }
    );

    const forkedContent = fs.readFileSync(path.join(projectDir, 'windows-fork-id.jsonl'), 'utf8');
    expect(forkedContent).toContain('\r\n');
    expect(forkedContent.endsWith('\r\n')).toBe(true);
    expect(forkedContent).toContain('Answer 1');
    randomUuidSpy.mockRestore();
  });
});
