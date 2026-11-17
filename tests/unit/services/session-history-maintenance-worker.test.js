'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const {
  compactDatabase,
  migrateStoredData,
  PREVIEW_MAX_CHARS,
  DATA_MIGRATION_VERSION
} = require('../../../src/server/services/session-history-maintenance-worker');

const LEGACY_FTS_TRIGGERS = `
  CREATE TRIGGER session_message_fts_insert AFTER INSERT ON session_message BEGIN
    INSERT INTO session_message_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
  CREATE TRIGGER session_message_fts_delete AFTER DELETE ON session_message BEGIN
    INSERT INTO session_message_fts(session_message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  END;
  CREATE TRIGGER session_message_fts_update AFTER UPDATE ON session_message BEGIN
    INSERT INTO session_message_fts(session_message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO session_message_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
`;

function createLegacyDatabase(dbPath) {
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  db.exec(`
    CREATE TABLE session_summary (
      source TEXT NOT NULL,
      file_path TEXT NOT NULL,
      session_id TEXT NOT NULL,
      first_message TEXT,
      PRIMARY KEY (source, file_path)
    );
    CREATE TABLE session_file (
      source TEXT NOT NULL,
      file_path TEXT NOT NULL,
      session_id TEXT NOT NULL,
      first_message TEXT,
      PRIMARY KEY (source, file_path),
      UNIQUE (source, session_id)
    );
    CREATE TABLE session_message (
      source TEXT NOT NULL,
      session_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      role TEXT,
      content TEXT,
      PRIMARY KEY (source, session_id, ordinal)
    );
    CREATE VIRTUAL TABLE session_message_fts USING fts5(
      content,
      content='session_message',
      content_rowid='rowid',
      tokenize='trigram'
    );
    ${LEGACY_FTS_TRIGGERS}
  `);

  const longPreview = 'preview-'.repeat(400);
  db.prepare('INSERT INTO session_summary(source, file_path, session_id, first_message) VALUES (?, ?, ?, ?)')
    .run('claude', '/tmp/session-a.jsonl', 'session-a', longPreview);
  db.prepare('INSERT INTO session_summary(source, file_path, session_id, first_message) VALUES (?, ?, ?, ?)')
    .run('claude', '/tmp/session-b.jsonl', 'session-b', longPreview);
  db.prepare('INSERT INTO session_file(source, file_path, session_id, first_message) VALUES (?, ?, ?, ?)')
    .run('claude', '/tmp/session-a.jsonl', 'session-a', longPreview);
  db.prepare('INSERT INTO session_file(source, file_path, session_id, first_message) VALUES (?, ?, ?, ?)')
    .run('claude', '/tmp/session-b.jsonl', 'session-b', longPreview);

  const insertMessage = db.prepare(
    'INSERT INTO session_message(source, session_id, ordinal, role, content) VALUES (?, ?, ?, ?, ?)'
  );
  insertMessage.run('claude', 'session-a', 0, 'user', 'userneedleword');
  insertMessage.run('claude', 'session-a', 1, 'assistant', 'assistantneedleword');
  insertMessage.run('claude', 'session-a', 2, 'assistant', null);
  for (let index = 0; index < 250; index += 1) {
    insertMessage.run('claude', 'session-b', index, 'assistant', `bulk assistant body ${index}`);
  }
  insertMessage.run('claude', 'orphan-session', 0, 'assistant', 'orphanneedleword');
  insertMessage.run('claude', 'orphan-session', 1, 'user', 'orphan user body');
  db.close();
}

describe('session-history maintenance migration', () => {
  let tempDir;
  let dbPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-history-migration-'));
    dbPath = path.join(tempDir, 'session-history.sqlite');
    createLegacyDatabase(dbPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('clears assistant bodies, truncates previews and drops orphan rows linearly', async () => {
    const result = await compactDatabase(dbPath);
    expect(result.status).toBe('migrated');
    expect(result.vacuumSkipped).toBe(true);
    expect(result.migration).toMatchObject({ alreadyDone: false });

    const db = new DatabaseSync(dbPath, { timeout: 5000 });
    try {
      const summary = db.prepare('SELECT first_message FROM session_summary WHERE session_id = ?').get('session-a');
      const file = db.prepare('SELECT first_message FROM session_file WHERE session_id = ?').get('session-a');
      expect(summary.first_message).toHaveLength(PREVIEW_MAX_CHARS);
      expect(file.first_message).toHaveLength(PREVIEW_MAX_CHARS);

      const rows = db.prepare(
        'SELECT session_id, role, content FROM session_message ORDER BY session_id, ordinal'
      ).all();
      expect(rows.some(row => row.session_id === 'orphan-session')).toBe(false);
      expect(rows.filter(row => row.role === 'user').every(row => Boolean(row.content))).toBe(true);
      expect(rows.filter(row => row.role !== 'user').every(row => row.content === null)).toBe(true);
      expect(rows).toHaveLength(1 + 1 + 1 + 250);

      // The FTS index must no longer match assistant-only bodies.
      const userMatches = db.prepare(`
        SELECT sm.role FROM session_message_fts fts
        JOIN session_message sm ON sm.rowid = fts.rowid
        WHERE session_message_fts MATCH ?
      `).all('userneedleword');
      const assistantMatches = db.prepare(`
        SELECT sm.role FROM session_message_fts fts
        JOIN session_message sm ON sm.rowid = fts.rowid
        WHERE session_message_fts MATCH ?
      `).all('assistantneedleword');
      expect(userMatches.map(row => row.role)).toEqual(['user']);
      expect(assistantMatches).toHaveLength(0);

      expect(db.prepare('PRAGMA user_version').get().user_version).toBe(DATA_MIGRATION_VERSION);

      // User-only triggers are installed for future writes.
      db.prepare('INSERT INTO session_message(source, session_id, ordinal, role, content) VALUES (?, ?, ?, ?, ?)')
        .run('claude', 'session-a', 3, 'assistant', 'newassistantneedle');
      db.prepare('INSERT INTO session_message(source, session_id, ordinal, role, content) VALUES (?, ?, ?, ?, ?)')
        .run('claude', 'session-a', 4, 'user', 'newuserneedle');
      const future = db.prepare(`
        SELECT sm.role FROM session_message_fts fts
        JOIN session_message sm ON sm.rowid = fts.rowid
        WHERE session_message_fts MATCH ?
      `).all('newassistantneedle');
      expect(future).toHaveLength(0);
    } finally {
      db.close();
    }

    const replayDb = new DatabaseSync(dbPath, { timeout: 5000 });
    try {
      const second = await migrateStoredData(replayDb);
      expect(second.alreadyDone).toBe(true);
    } finally {
      replayDb.close();
    }
  });
});
