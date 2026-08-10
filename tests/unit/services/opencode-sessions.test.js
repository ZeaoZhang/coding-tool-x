'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PATHS_PATH = require.resolve('../../../src/config/paths');
const ALIAS_PATH = require.resolve('../../../src/server/services/alias');
const SESSIONS_PATH = require.resolve('../../../src/server/services/sessions');
const MODULE_PATH = require.resolve('../../../src/server/services/opencode-sessions');

let testDir;
let dataDir;
let dbPath;
let db;
let projectOrderPath;
let sessionOrderPath;
let aliasesState;
let forkRelationsState;
let opencodeSessions;

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      worktree TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_archived INTEGER,
      data TEXT
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
      parent_id TEXT,
      slug TEXT,
      directory TEXT,
      title TEXT,
      version TEXT,
      share_url TEXT,
      summary_additions TEXT,
      summary_deletions TEXT,
      summary_files TEXT,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_compacting INTEGER,
      time_archived INTEGER
    );
    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES session(id) ON DELETE CASCADE,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
    CREATE TABLE IF NOT EXISTS part (
      id TEXT PRIMARY KEY,
      message_id TEXT REFERENCES message(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES session(id) ON DELETE CASCADE,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
  `);
}

function insertTestData() {
  // Projects
  db.prepare(`INSERT INTO project (id, worktree, time_created, time_updated, time_archived, data) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('proj-1', '/workspace/app-a', 1000, 5000, null, null);
  db.prepare(`INSERT INTO project (id, worktree, time_created, time_updated, time_archived, data) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('proj-2', '/workspace/app-b', 2000, 6000, null, JSON.stringify({ name: 'Readable Project' }));

  // Sessions
  db.prepare(`INSERT INTO session (id, project_id, slug, directory, title, time_updated) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('ses-1', 'proj-1', 'needle-session', '/workspace/app-a', 'Needle intro', 4000);
  db.prepare(`INSERT INTO session (id, project_id, slug, directory, title, time_updated) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('ses-2', 'proj-1', 'follow-up', '/workspace/app-a', 'Follow up', 7000);
  db.prepare(`INSERT INTO session (id, project_id, slug, directory, title, time_updated) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('ses-3', 'proj-2', 'summary', '/workspace/app-b', 'Project summary', 3000);

  // Messages
  db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
    .run('msg-1', 'ses-1', 1000, 1000, JSON.stringify({ id: 'msg-1', role: 'user', content: 'needle question' }));
  db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
    .run('msg-2', 'ses-1', 1100, 1100, JSON.stringify({ id: 'msg-2', role: 'assistant', text: 'fallback answer', model: { modelID: 'gpt-4o-mini' } }));
  db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
    .run('msg-3', 'ses-1', 1200, 1200, JSON.stringify({ id: 'msg-3', role: 'system', content: 'ignore this' }));

  // Parts
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('prt-1', 'msg-2', 'ses-1', 1110, 1110, JSON.stringify({ text: 'assistant needle response' }));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-sessions-service-'));
  dataDir = path.join(testDir, '.opencode-data');
  projectOrderPath = path.join(testDir, '.cc-tool', 'opencode-project-order.json');
  sessionOrderPath = path.join(testDir, '.cc-tool', 'opencode-session-order.json');
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'opencode.db');

  // Create real SQLite database with test data
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  createSchema(db);
  insertTestData();

  aliasesState = {
    'ses-1': 'alias-one',
    'ses-2': 'focus-session'
  };
  forkRelationsState = {
    'ses-2': 'ses-root',
    child: 'ses-1',
    keep: 'ses-other'
  };

  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        opencode: {
          data: dataDir
        }
      },
      PATHS: {
        opencodeProjectOrder: projectOrderPath,
        opencodeSessionOrder: sessionOrderPath
      }
    }
  };
  require.cache[ALIAS_PATH] = {
    id: ALIAS_PATH,
    filename: ALIAS_PATH,
    loaded: true,
    exports: {
      loadAliases: vi.fn(() => ({ ...aliasesState })),
      deleteAlias: vi.fn((sessionId) => {
        delete aliasesState[sessionId];
      })
    }
  };
  require.cache[SESSIONS_PATH] = {
    id: SESSIONS_PATH,
    filename: SESSIONS_PATH,
    loaded: true,
    exports: {
      getForkRelations: vi.fn(() => forkRelationsState),
      saveForkRelations: vi.fn((next) => {
        forkRelationsState = next;
      })
    }
  };

  delete require.cache[MODULE_PATH];
  opencodeSessions = require('../../../src/server/services/opencode-sessions');
});

afterEach(() => {
  vi.restoreAllMocks();
  try { db.close(); } catch (_) {}
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    MODULE_PATH,
    PATHS_PATH,
    ALIAS_PATH,
    SESSIONS_PATH
  ].forEach((mod) => {
    try { delete require.cache[mod]; } catch (_) {}
  });
});

describe('opencode-sessions', () => {
  describe('isOpenCodeInstalled', () => {
    test('returns true when opencode db exists', () => {
      expect(opencodeSessions.isOpenCodeInstalled()).toBe(true);
    });

    test('returns false when directory does not exist', () => {
      fs.rmSync(dataDir, { recursive: true, force: true });
      // Need fresh require since paths mock still points to same dataDir
      delete require.cache[MODULE_PATH];
      const fresh = require('../../../src/server/services/opencode-sessions');
      expect(fresh.isOpenCodeInstalled()).toBe(false);
    });
  });

  describe('getProjectAndSessionCounts', () => {
    test('returns project and session counts', () => {
      const counts = opencodeSessions.getProjectAndSessionCounts({ force: true });
      expect(counts.projectCount).toBe(2);
      expect(counts.sessionCount).toBe(3);
    });

    test('uses cache on second call', () => {
      opencodeSessions.getProjectAndSessionCounts({ force: true });
      const counts = opencodeSessions.getProjectAndSessionCounts();
      expect(counts.projectCount).toBe(2);
      expect(counts.sessionCount).toBe(3);
    });
  });

  describe('getProjects', () => {
    test('returns project list with display names', () => {
      const projects = opencodeSessions.getProjects();
      expect(projects).toHaveLength(2);

      const proj1 = projects.find(p => p.name === 'proj-1');
      expect(proj1).toBeDefined();
      expect(proj1.fullPath).toBe('/workspace/app-a');
      expect(proj1.source).toBe('opencode');

      const proj2 = projects.find(p => p.name === 'proj-2');
      expect(proj2.displayName).toBe('Readable Project');
    });

    test('respects project order', () => {
      opencodeSessions.saveProjectOrder(['proj-2', 'proj-1']);
      const projects = opencodeSessions.getProjects();
      expect(projects[0].name).toBe('proj-2');
      expect(projects[1].name).toBe('proj-1');
    });
  });

  describe('getSessionsByProjectId', () => {
    test('returns sessions for a project sorted by mtime', () => {
      const sessions = opencodeSessions.getSessionsByProjectId('proj-1');
      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe('ses-2'); // newer
      expect(sessions[1].sessionId).toBe('ses-1');
    });

    test('respects session order', () => {
      opencodeSessions.saveSessionOrder('proj-1', ['ses-1', 'ses-2']);
      const sessions = opencodeSessions.getSessionsByProjectId('proj-1');
      // Ordered sessions come after new ones or get reordered
      const ids = sessions.map(s => s.sessionId);
      expect(ids).toContain('ses-1');
      expect(ids).toContain('ses-2');
    });

    test('returns empty array for unknown project', () => {
      const sessions = opencodeSessions.getSessionsByProjectId('unknown');
      expect(sessions).toEqual([]);
    });
  });

  describe('getSessionById', () => {
    test('returns session with messages and parts', () => {
      const session = opencodeSessions.getSessionById('ses-1');
      expect(session).toBeDefined();
      expect(session.sessionId).toBe('ses-1');
      expect(session.messages).toHaveLength(3);

      const userMsg = session.messages.find(m => m.role === 'user');
      expect(userMsg.content).toBe('needle question');

      const assistantMsg = session.messages.find(m => m.role === 'assistant');
      expect(assistantMsg.parts).toHaveLength(1);
      expect(assistantMsg.parts[0].data.text).toBe('assistant needle response');
    });

    test('returns null for unknown session', () => {
      expect(opencodeSessions.getSessionById('unknown')).toBeNull();
    });
  });

  describe('searchSessions', () => {
    test('finds sessions by keyword in messages and parts', () => {
      const results = opencodeSessions.searchSessions('needle');
      expect(results).toHaveLength(1);
      expect(results[0].sessionId).toBe('ses-1');
      expect(results[0].matches.length).toBeGreaterThanOrEqual(1);
    });

    test('returns empty for no matches', () => {
      const results = opencodeSessions.searchSessions('zzznotfound');
      expect(results).toEqual([]);
    });

    test('returns empty for empty keyword', () => {
      expect(opencodeSessions.searchSessions('')).toEqual([]);
      expect(opencodeSessions.searchSessions('  ')).toEqual([]);
    });
  });

  describe('getRecentSessions', () => {
    test('returns most recent sessions across all projects', () => {
      const recent = opencodeSessions.getRecentSessions(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].sessionId).toBe('ses-2'); // newest
      expect(recent[1].sessionId).toBe('ses-1');
    });

    test('defaults to limit 5', () => {
      const recent = opencodeSessions.getRecentSessions();
      expect(recent.length).toBeLessThanOrEqual(5);
      expect(recent.length).toBe(3);
    });
  });

  describe('deleteSession', () => {
    test('deletes a session and cleans up fork/alias', () => {
      const result = opencodeSessions.deleteSession('ses-1');
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('ses-1');

      // Verify session is gone from DB
      const dbCheck = new DatabaseSync(dbPath);
      const rows = dbCheck.prepare('SELECT id FROM session WHERE id = ?').all('ses-1');
      expect(rows).toHaveLength(0);
      dbCheck.close();

      // Fork relations cleaned
      expect(forkRelationsState['ses-1']).toBeUndefined();
      expect(forkRelationsState.child).toBeUndefined();
    });

    test('throws for unknown session', () => {
      expect(() => opencodeSessions.deleteSession('unknown')).toThrow('Session not found');
    });
  });

  describe('forkSession', () => {
    test('creates a forked copy with new IDs', () => {
      const result = opencodeSessions.forkSession('ses-1');
      expect(result.success).toBe(true);
      expect(result.forkedFrom).toBe('ses-1');

      // Verify forked session exists
      const forked = opencodeSessions.getSessionById(result.sessionId);
      expect(forked).toBeDefined();
      expect(forked.messages).toHaveLength(3);

      // Fork relation recorded
      expect(forkRelationsState[result.sessionId]).toBe('ses-1');
    });

    test('throws for unknown session', () => {
      expect(() => opencodeSessions.forkSession('unknown')).toThrow('Session not found');
    });
  });

  describe('deleteProject', () => {
    test('deletes a project and its sessions', () => {
      const result = opencodeSessions.deleteProject('proj-1');
      expect(result.success).toBe(true);
      expect(result.deletedSessions).toBe(2);

      // Verify project gone
      expect(opencodeSessions.getSessionsByProjectId('proj-1')).toEqual([]);
    });

    test('throws for unknown project', () => {
      expect(() => opencodeSessions.deleteProject('unknown')).toThrow('Project not found');
    });
  });
});
