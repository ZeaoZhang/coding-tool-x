'use strict';

const path = require('path');
const { fork } = require('child_process');
const {
  getSnapshot,
  invalidateSnapshot
} = require('./snapshot-cache');

const SESSION_SNAPSHOT_TTL_MS = 60 * 1000;
const SESSION_SNAPSHOT_DEFER_MS = process.env.NODE_ENV === 'test' ? 0 : 750;
const SESSION_SNAPSHOT_WORKER_TIMEOUT_MS = 180 * 1000;
const SESSION_SNAPSHOT_WAIT_ON_MISS_MS = process.env.NODE_ENV === 'test' ? 0 : 2500;
const SESSION_SNAPSHOT_WAIT_ON_FORCE_MS = process.env.NODE_ENV === 'test' ? 0 : 2500;

function sessionListKey(source, projectName) {
  return `sessions:list:${source}:${projectName}`;
}

function defaultProjectInfo(projectName) {
  return {
    name: projectName,
    fullPath: projectName,
    path: projectName,
    displayName: projectName
  };
}

function emptySessionList(projectName, extra = {}) {
  return {
    sessions: [],
    totalSize: 0,
    aliases: {},
    projectInfo: defaultProjectInfo(projectName),
    ...extra
  };
}

function runSessionSnapshotWorker(source, projectName, config = {}, options = {}) {
  if (process.env.NODE_ENV === 'test') {
    const { buildPayload } = require('./session-snapshot-worker');
    return Promise.resolve(buildPayload({ source, projectName, config, options }));
  }

  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'session-snapshot-worker.js');
    const child = fork(workerPath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
      env: {
        ...process.env,
        CC_TOOL_SESSION_SNAPSHOT_WORKER: '1'
      }
    });

    let settled = false;
    let stderr = '';
    let timeout = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      child.removeAllListeners();
      if (!child.killed) {
        child.kill();
      }
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    timeout = setTimeout(() => {
      finish(new Error(`Session snapshot refresh timed out for ${source}/${projectName}`));
    }, SESSION_SNAPSHOT_WORKER_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096);
      }
    });

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.ok) {
        finish(null, message.value);
      } else {
        finish(new Error(message.error || `Session snapshot refresh failed for ${source}/${projectName}`));
      }
    });

    child.on('error', (error) => finish(error));
    child.on('exit', (code, signal) => {
      if (settled) return;
      const suffix = stderr ? `: ${stderr.trim()}` : '';
      finish(new Error(`Session snapshot worker exited (${code || signal || 'unknown'})${suffix}`));
    });

    child.send({ source, projectName, config, options });
  });
}

async function getSessionListSnapshot(source, projectName, {
  fallbackValue,
  refresh,
  force = false
}) {
  return getSnapshot(sessionListKey(source, projectName), {
    ttlMs: SESSION_SNAPSHOT_TTL_MS,
    fallbackValue: fallbackValue || emptySessionList(projectName),
    refresh,
    force: process.env.NODE_ENV === 'test' ? true : force,
    backgroundOnMiss: process.env.NODE_ENV === 'test' ? false : !force,
    staleWhileForce: true,
    waitOnMissMs: SESSION_SNAPSHOT_WAIT_ON_MISS_MS,
    waitOnForceMs: SESSION_SNAPSHOT_WAIT_ON_FORCE_MS,
    deferMs: SESSION_SNAPSHOT_DEFER_MS
  });
}

function invalidateSessionSnapshots(source, projectName = null) {
  if (!source) return;
  if (projectName) {
    invalidateSnapshot(sessionListKey(source, projectName));
    return;
  }
  invalidateSnapshot(`sessions:list:${source}:`);
}

module.exports = {
  SESSION_SNAPSHOT_TTL_MS,
  SESSION_SNAPSHOT_WAIT_ON_MISS_MS,
  SESSION_SNAPSHOT_WAIT_ON_FORCE_MS,
  SESSION_SNAPSHOT_WORKER_TIMEOUT_MS,
  defaultProjectInfo,
  emptySessionList,
  getSessionListSnapshot,
  invalidateSessionSnapshots,
  runSessionSnapshotWorker,
  sessionListKey
};
