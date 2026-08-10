import { describe, it, afterEach, expect } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { openDatabase, closeDatabase, closeAllDatabases } from '../../../src/server/services/sqlite-connection.js';

function tempDbPath(label = '') {
  return path.join(os.tmpdir(), `ctx-test-sqlite-conn-${Date.now()}-${label}.sqlite`);
}

describe('sqlite-connection', () => {
  /** @type {string[]} */
  const dbPaths = [];

  afterEach(() => {
    closeAllDatabases();
    for (const p of dbPaths.splice(0)) {
      try { fs.unlinkSync(p); } catch (_) {}
      try { fs.unlinkSync(p + '-wal'); } catch (_) {}
      try { fs.unlinkSync(p + '-shm'); } catch (_) {}
    }
  });

  function trackTempDb(filePath) {
    dbPaths.push(filePath);
  }

  it('opens and returns a DatabaseSync instance', () => {
    const p = tempDbPath('open');
    trackTempDb(p);
    const db = openDatabase(p);
    expect(db).toBeDefined();
    expect(typeof db.exec).toBe('function');
    expect(typeof db.prepare).toBe('function');
  });

  it('reuses the same connection for the same path', () => {
    const p = tempDbPath('reuse');
    trackTempDb(p);
    const db1 = openDatabase(p);
    const db2 = openDatabase(p);
    expect(db1).toBe(db2);
  });

  it('reuses connections by canonical path', () => {
    const p = tempDbPath('canonical');
    trackTempDb(p);
    const db1 = openDatabase(p);
    const db2 = openDatabase(path.join(os.tmpdir(), '..', path.basename(os.tmpdir()), path.basename(p)));
    expect(db1).toBe(db2);
  });

  it('supports prepared statement with parameter binding', () => {
    const p = tempDbPath('prep');
    trackTempDb(p);
    const db = openDatabase(p);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const stmt = db.prepare('INSERT INTO t (v) VALUES (?)');
    stmt.run('hello');
    stmt.run('world');

    const rows = db.prepare('SELECT v FROM t ORDER BY id').all();
    expect(rows).toEqual([{ v: 'hello' }, { v: 'world' }]);
  });

  it('supports multiple independent connections', () => {
    const p1 = tempDbPath('multi-a');
    trackTempDb(p1);
    const p2 = tempDbPath('multi-b');
    trackTempDb(p2);
    const db1 = openDatabase(p1);
    db1.exec('CREATE TABLE a (x)');
    const db2 = openDatabase(p2);
    db2.exec('CREATE TABLE b (y)');

    // Verify they are independent
    const aCols = db1.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='a'").all();
    const bCols = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='b'").all();
    expect(aCols).toHaveLength(1);
    expect(bCols).toHaveLength(1);
  });

  it('read-only rejects write statements', () => {
    const p = tempDbPath('ro');
    trackTempDb(p);
    const dbWrite = openDatabase(p);
    dbWrite.exec('CREATE TABLE ro (v)');
    closeDatabase(p);

    const dbRead = openDatabase(p, { readOnly: true });
    expect(() => dbRead.exec('INSERT INTO ro VALUES (?)', ['test'])).toThrow();
  });

  it('read-only allows reads', () => {
    const p = tempDbPath('ro-read');
    trackTempDb(p);
    const dbWrite = openDatabase(p);
    dbWrite.exec('CREATE TABLE ro (v)');
    dbWrite.prepare('INSERT INTO ro VALUES (?)').run('data');
    closeDatabase(p);

    const dbRead = openDatabase(p, { readOnly: true });
    const rows = dbRead.prepare('SELECT v FROM ro').all();
    expect(rows).toEqual([{ v: 'data' }]);
  });

  it('closeDatabase is idempotent', () => {
    const p = tempDbPath('idem-close');
    trackTempDb(p);
    openDatabase(p);
    closeDatabase(p);
    closeDatabase(p);
    expect(() => closeDatabase(p)).not.toThrow();
  });

  it('closeAllDatabases is idempotent', () => {
    const p1 = tempDbPath('all-a');
    trackTempDb(p1);
    const p2 = tempDbPath('all-b');
    trackTempDb(p2);
    openDatabase(p1);
    openDatabase(p2);
    closeAllDatabases();
    closeAllDatabases();
    expect(() => closeAllDatabases()).not.toThrow();
  });

  it('foreign keys pragma is set on writable connections', () => {
    const p = tempDbPath('fk');
    trackTempDb(p);
    const db = openDatabase(p);
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id))');
    expect(() => db.exec('INSERT INTO child (pid) VALUES (999)')).toThrow();
  });
});
