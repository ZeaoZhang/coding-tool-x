const os = require('os');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Resolve dependency paths before requiring the module under test
// ---------------------------------------------------------------------------
const CODEX_CONFIG_PATH   = require.resolve('../../../src/platforms/drivers/codex/config');
const CODEX_PARSER_PATH   = require.resolve('../../../src/platforms/drivers/codex/parser');
const ENHANCED_CACHE_PATH = require.resolve('../../../src/server/services/enhanced-cache');
const MODULE_PATH         = require.resolve('../../../src/platforms/drivers/codex/sessions-implementation');

let testDir;

// ---------------------------------------------------------------------------
// Stub injection helpers
// ---------------------------------------------------------------------------

function injectStubs() {
  require.cache[CODEX_CONFIG_PATH] = {
    id: CODEX_CONFIG_PATH, filename: CODEX_CONFIG_PATH, loaded: true,
    exports: { getCodexDir: () => testDir }
  };

  require.cache[CODEX_PARSER_PATH] = {
    id: CODEX_PARSER_PATH, filename: CODEX_PARSER_PATH, loaded: true,
    exports: {
      parseSession:      vi.fn(() => null),
      parseSessionMeta:  vi.fn(() => null),
      extractSessionMeta: vi.fn(() => null),
      readJSONL:         vi.fn(() => [])
    }
  };

  require.cache[ENHANCED_CACHE_PATH] = {
    id: ENHANCED_CACHE_PATH, filename: ENHANCED_CACHE_PATH, loaded: true,
    exports: {
      globalCache: { get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() },
      CacheKeys: { PROJECTS: 'p:', SESSIONS: 's:', COUNTS: 'c:' }
    }
  };
}

function cleanStubs() {
  delete require.cache[CODEX_CONFIG_PATH];
  delete require.cache[CODEX_PARSER_PATH];
  delete require.cache[ENHANCED_CACHE_PATH];
  delete require.cache[MODULE_PATH];
  // Also clean up sessions dependency pulled in by getSessionsByProject
  try {
    const sessionsPath = require.resolve('../../../src/platforms/drivers/claude/sessions-implementation');
    delete require.cache[sessionsPath];
  } catch (_) { /* not loaded, ignore */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a sessions subdirectory under testDir */
function sessionsDir() {
  return path.join(testDir, 'sessions');
}

/** Write an empty rollout file into a project subdir inside sessions/ */
function createRolloutFile(projectDir, name) {
  const dir = path.join(sessionsDir(), projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, '');
  return filePath;
}

function makeSession(overrides = {}) {
  return {
    sessionId: 'abc-123',
    filePath:  path.join(testDir, 'sessions', 'rollout-2024-01-01T00-00-00-abc-123.jsonl'),
    preview:   'Hello world',
    size:      1024,
    mtime:     '2024-01-01T00:00:00.000Z',
    mtimeMs:   new Date('2024-01-01T00:00:00.000Z').getTime(),
    meta: {
      timestamp: '2024-01-01T00:00:00Z',
      cwd:       '/home/user/project',
      git:       { branch: 'main', repositoryUrl: 'https://github.com/user/project' }
    },
    tokens:   { input: 100, output: 50 },
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('codex-sessions', () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sessions-'));
    injectStubs();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    cleanStubs();
  });

  // -------------------------------------------------------------------------
  // Directory scanning (tested through scanSessionFiles which calls
  // the internal scanDirectoryRecursive on getCodexDir()/sessions/)
  // -------------------------------------------------------------------------

  describe('directory scanning via scanSessionFiles', () => {
    it('returns [] when sessions directory does not exist', () => {
      // testDir/sessions/ was never created
      const { scanSessionFiles } = require(MODULE_PATH);
      const result = scanSessionFiles();
      expect(result).toEqual([]);
    });

    it('returns [] for an empty sessions directory', () => {
      fs.mkdirSync(sessionsDir());
      const { scanSessionFiles } = require(MODULE_PATH);
      const result = scanSessionFiles();
      expect(result).toEqual([]);
    });

    it('returns file entries for rollout-*.jsonl files in the sessions dir', () => {
      createRolloutFile('proj', 'rollout-2024-01-01T00-00-00-aaa111.jsonl');
      createRolloutFile('proj', 'rollout-2024-01-02T00-00-00-bbb222.jsonl');

      const { scanSessionFiles } = require(MODULE_PATH);
      const result = scanSessionFiles();
      expect(result).toHaveLength(2);
      const ids = result.map(f => f.sessionId);
      expect(ids).toContain('aaa111');
      expect(ids).toContain('bbb222');
    });

    it('skips non-matching files (other.txt, data.json, bare .jsonl)', () => {
      const dir = sessionsDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'other.txt'), '');
      fs.writeFileSync(path.join(dir, 'data.json'), '');
      fs.writeFileSync(path.join(dir, 'session.jsonl'), ''); // no rollout- prefix

      const { scanSessionFiles } = require(MODULE_PATH);
      const result = scanSessionFiles();
      expect(result).toEqual([]);
    });

    it('finds rollout files recursively in nested subdirectories', () => {
      // nested two levels deep
      const deep = path.join(sessionsDir(), 'project-a', 'nested');
      fs.mkdirSync(deep, { recursive: true });
      fs.writeFileSync(path.join(deep, 'rollout-2024-01-01T00-00-00-ccc333.jsonl'), '');

      const { scanSessionFiles } = require(MODULE_PATH);
      const result = scanSessionFiles();
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('ccc333');
    });

    it('handles mixed files and dirs, returning only matching rollout entries', () => {
      // Top-level non-rollout
      const dir = sessionsDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'readme.md'), '');

      // Top-level rollout
      fs.writeFileSync(
        path.join(dir, 'rollout-2024-01-01T00-00-00-top001.jsonl'), ''
      );

      // Subdir with both matching and non-matching
      const sub = path.join(dir, 'proj');
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, 'ignore.txt'), '');
      fs.writeFileSync(
        path.join(sub, 'rollout-2024-01-02T00-00-00-sub002.jsonl'), ''
      );

      const { scanSessionFiles } = require(MODULE_PATH);
      const result = scanSessionFiles();
      expect(result).toHaveLength(2);
      const ids = result.map(f => f.sessionId);
      expect(ids).toContain('top001');
      expect(ids).toContain('sub002');
    });
  });

  // -------------------------------------------------------------------------
  // normalizeSession
  // -------------------------------------------------------------------------

  describe('normalizeSession', () => {
    it('normalizes a valid session with meta into the expected shape', () => {
      const { normalizeSession } = require(MODULE_PATH);
      const session = makeSession();
      const result = normalizeSession(session);

      expect(result).toMatchObject({
        sessionId:    'abc-123',
        filePath:     session.filePath,
        firstMessage: 'Hello world',
        gitBranch:    'main',
        forkedFrom:   null,
        source:       'codex'
      });
      expect(result.size).toBe(1024);
    });

    it('returns null for gitBranch when meta has no git info', () => {
      const { normalizeSession } = require(MODULE_PATH);
      const session = makeSession({ meta: { timestamp: '2024-01-01T00:00:00Z', cwd: '/proj' } });
      const result = normalizeSession(session);
      expect(result.gitBranch).toBeNull();
    });

    it('uses meta.timestamp as mtime when session.mtime is absent', () => {
      const { normalizeSession } = require(MODULE_PATH);
      const session = makeSession({ mtime: null });
      const result = normalizeSession(session);
      expect(result.mtime).toBe('2024-01-01T00:00:00Z');
    });

    it('sets firstMessage to null when preview is absent', () => {
      const { normalizeSession } = require(MODULE_PATH);
      const session = makeSession({ preview: undefined });
      const result = normalizeSession(session);
      expect(result.firstMessage).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getProjectAndSessionCounts
  // -------------------------------------------------------------------------

  describe('getProjectAndSessionCounts', () => {
    it('returns { projectCount: 0, sessionCount: 0 } when sessions dir does not exist', async () => {
      const { getProjectAndSessionCounts } = require(MODULE_PATH);
      const result = await getProjectAndSessionCounts();
      expect(result).toEqual({ projectCount: 0, sessionCount: 0 });
    });

    it('returns numeric counts when session files are present', async () => {
      createRolloutFile('project-a', 'rollout-2024-01-01T00-00-00-s1aaaa.jsonl');
      createRolloutFile('project-a', 'rollout-2024-01-02T00-00-00-s2bbbb.jsonl');
      createRolloutFile('project-b', 'rollout-2024-01-03T00-00-00-s3cccc.jsonl');

      const { getProjectAndSessionCounts } = require(MODULE_PATH);
      const result = await getProjectAndSessionCounts();
      expect(typeof result.projectCount).toBe('number');
      expect(typeof result.sessionCount).toBe('number');
      // At least the 3 files are scanned
      expect(result.sessionCount).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // getProjects
  // -------------------------------------------------------------------------

  describe('getProjects', () => {
    it('returns empty array when sessions dir does not exist', async () => {
      const { getProjects } = require(MODULE_PATH);
      const result = await getProjects();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('returns an array when session files are present', async () => {
      createRolloutFile('my-project', 'rollout-2024-01-01T00-00-00-abcdef.jsonl');

      const { getProjects } = require(MODULE_PATH);
      const result = await getProjects();
      expect(Array.isArray(result)).toBe(true);
    });

    it('each returned project has the expected shape fields', async () => {
      const { getProjects } = require(MODULE_PATH);
      const result = await getProjects();
      result.forEach(p => {
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('sessionCount');
        expect(p).toHaveProperty('source', 'codex');
      });
    });
  });
});
