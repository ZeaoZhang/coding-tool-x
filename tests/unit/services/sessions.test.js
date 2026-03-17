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
    exports: { loadAliases: vi.fn(() => ({})) },
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
      globalCache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      CacheKeys:   { PROJECTS: 'p:', SESSIONS: 's:', COUNTS: 'c:', HAS_MESSAGES: 'hm:' },
    },
  };

  // Force fresh require of sessions module with new stubs
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
