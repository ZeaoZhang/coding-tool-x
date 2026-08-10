'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

/** @type {Map<string, DatabaseSync>} */
const _connections = new Map();

/**
 * Canonicalize a file path for use as a connection key.
 * @param {string} filePath
 * @returns {string}
 */
function _canonicalize(filePath) {
  return path.resolve(filePath);
}

/**
 * Open or return an existing DatabaseSync connection for `filePath`.
 *
 * @param {string} filePath - path to the SQLite database file
 * @param {{ readOnly?: boolean, timeout?: number }} [options]
 * @returns {DatabaseSync}
 */
function openDatabase(filePath, options = {}) {
  const key = _canonicalize(filePath);
  if (_connections.has(key)) {
    return _connections.get(key);
  }

  if (!options.readOnly) {
    fs.mkdirSync(path.dirname(key), { recursive: true });
  }

  const db = new DatabaseSync(key, {
    readOnly: options.readOnly === true,
    timeout: options.timeout != null ? options.timeout : 5000
  });

  if (!options.readOnly) {
    db.exec('PRAGMA foreign_keys = ON');
  }

  _connections.set(key, db);
  return db;
}

/**
 * Close and remove the cached connection for `filePath`. Idempotent.
 *
 * @param {string} filePath
 */
function closeDatabase(filePath) {
  const key = _canonicalize(filePath);
  const db = _connections.get(key);
  if (!db) {
    return;
  }
  db.close();
  _connections.delete(key);
}

/**
 * Close and remove every cached connection. Idempotent.
 */
function closeAllDatabases() {
  for (const db of _connections.values()) {
    try {
      db.close();
    } catch (_err) {
      // swallow — best-effort teardown
    }
  }
  _connections.clear();
}

module.exports = { openDatabase, closeDatabase, closeAllDatabases };
