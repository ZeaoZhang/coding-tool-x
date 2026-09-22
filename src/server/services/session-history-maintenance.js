'use strict';

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { PATHS } = require('../../config/paths');

const MAINTENANCE_LOCK_STALE_MS = 30 * 60 * 1000;
const INITIAL_MAINTENANCE_DELAY_MS = 60 * 1000;
const RETRY_MAINTENANCE_DELAY_MS = 5 * 60 * 1000;
const MAINTENANCE_WORKER_PATH = path.join(__dirname, 'session-history-maintenance-worker.js');

const scheduledMaintenances = new Map();

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireMaintenanceLock(dbPath) {
  const lockPath = `${path.resolve(dbPath)}.maintenance.lock`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8');
      return { fd, lockPath };
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) {}
        try { fs.unlinkSync(lockPath); } catch (_) {}
      }
      if (error?.code !== 'EEXIST') throw error;
    }

    let owner = null;
    let ageMs = 0;
    try {
      owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      ageMs = Math.max(0, Date.now() - fs.statSync(lockPath).mtimeMs);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
    }

    const ownerPid = Number(owner?.pid);
    if (isProcessAlive(ownerPid)) return null;
    if ((!Number.isInteger(ownerPid) || ownerPid <= 0) && ageMs < MAINTENANCE_LOCK_STALE_MS) {
      return null;
    }

    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') return null;
    }
  }

  return null;
}

function releaseMaintenanceLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.fd); } catch (_) {}
  try { fs.unlinkSync(lock.lockPath); } catch (_) {}
}

function runMaintenanceWorker(dbPath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(MAINTENANCE_WORKER_PATH, { workerData: { dbPath } });
    let settled = false;
    worker.unref();

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result);
    };

    worker.on('message', (message) => {
      if (message?.type === 'done') {
        finish(null, message.result);
      } else if (message?.type === 'error') {
        finish(new Error(message.error || '会话索引维护线程失败'));
      }
    });

    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        finish(new Error(`会话索引维护线程异常退出（代码 ${code}）`));
      } else if (!settled) {
        finish(null, { status: 'skipped' });
      }
    });
  });
}

function isRetryableMaintenanceError(error) {
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(error?.message || '');
}

async function runScheduledMaintenance(dbPath) {
  let lock = null;
  try {
    if (!dbPath || !fs.existsSync(dbPath)) return false;

    lock = acquireMaintenanceLock(dbPath);
    if (!lock) return true;

    const lockState = require('./session-history-index').cleanupStaleInventoryLocks(dbPath);
    if (lockState.retained.length > 0) return true;

    const result = await runMaintenanceWorker(dbPath);
    return result.status === 'database-busy';
  } catch (error) {
    return isRetryableMaintenanceError(error);
  } finally {
    releaseMaintenanceLock(lock);
  }
}

function scheduleMaintenanceAttempt(dbPath, delayMs) {
  const key = path.resolve(dbPath);
  const state = scheduledMaintenances.get(key);
  if (!state || state.timer || state.running) return;

  state.timer = setTimeout(async () => {
    state.timer = null;
    state.running = true;
    let retry = false;
    try {
      retry = await runScheduledMaintenance(key);
    } catch (_) {
      retry = false;
    } finally {
      state.running = false;
      if (retry) {
        scheduleMaintenanceAttempt(key, RETRY_MAINTENANCE_DELAY_MS);
      } else if (scheduledMaintenances.get(key) === state) {
        scheduledMaintenances.delete(key);
      }
    }
  }, delayMs);
  state.timer.unref();
}

function scheduleSessionHistoryMaintenance(dbPath = PATHS.sessionHistoryIndex) {
  if (process.env.NODE_ENV === 'test' || !dbPath) return false;

  const key = path.resolve(dbPath);
  if (scheduledMaintenances.has(key)) return false;

  const state = { timer: null, running: false };
  scheduledMaintenances.set(key, state);
  scheduleMaintenanceAttempt(key, INITIAL_MAINTENANCE_DELAY_MS);
  return true;
}

module.exports = { scheduleSessionHistoryMaintenance };
