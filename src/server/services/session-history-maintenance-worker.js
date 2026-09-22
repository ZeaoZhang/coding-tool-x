'use strict';

const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('node:sqlite');

const MIN_FREE_BYTES = 256 * 1024 * 1024;
const MIN_FREE_RATIO = 0.2;

function readPragmaNumber(db, name) {
  return Number(db.prepare(`PRAGMA ${name}`).get()?.[name]) || 0;
}

function inspectDatabase(dbPath, db) {
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA cache_size = -16384;');
  const pageSize = readPragmaNumber(db, 'page_size');
  const pageCount = readPragmaNumber(db, 'page_count');
  const freePageCount = readPragmaNumber(db, 'freelist_count');
  const fileBytes = fs.statSync(dbPath).size;
  const freeBytes = pageSize * freePageCount;
  const pageBytes = pageSize * pageCount;

  if (freeBytes < MIN_FREE_BYTES || freeBytes < pageBytes * MIN_FREE_RATIO) {
    return { status: 'below-threshold', beforeBytes: fileBytes, freeBytes };
  }

  const disk = fs.statfsSync(path.dirname(dbPath));
  const availableBytes = Number(disk.bavail) * Number(disk.bsize);
  if (!Number.isFinite(availableBytes) || availableBytes < fileBytes) {
    return { status: 'insufficient-space', beforeBytes: fileBytes, freeBytes };
  }

  const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  if (Number(checkpoint?.busy) > 0) {
    return { status: 'database-busy', beforeBytes: fileBytes, freeBytes };
  }

  return { status: 'ready', beforeBytes: fileBytes, freeBytes };
}

function compactDatabase(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return { status: 'missing' };
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    const inspection = inspectDatabase(dbPath, db);
    if (inspection.status !== 'ready') return inspection;

    db.exec('VACUUM;');
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    const afterBytes = fs.statSync(dbPath).size;
    return {
      status: 'compacted',
      beforeBytes: inspection.beforeBytes,
      afterBytes,
      reclaimedBytes: Math.max(0, inspection.beforeBytes - afterBytes),
      checkpointBusy: Number(checkpoint?.busy) > 0
    };
  } finally {
    db.close();
  }
}

try {
  const result = compactDatabase(workerData?.dbPath);
  parentPort.postMessage({ type: 'done', result });
  parentPort.close();
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error?.message || String(error) });
  parentPort.close();
}
