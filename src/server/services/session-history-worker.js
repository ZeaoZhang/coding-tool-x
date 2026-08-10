'use strict';

const { fork } = require('child_process');
const path = require('path');

const WORKER_TIMEOUT_MS = 180000;

function runInventoryWorker(source, indexDbPath, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || WORKER_TIMEOUT_MS;
    const workerPath = path.resolve(__dirname, 'session-history-worker.js');

    const child = fork(workerPath, [], {
      env: {
        ...process.env,
        CC_TOOL_SESSION_HISTORY_WORKER: '1',
        CC_TOOL_SESSION_HISTORY_SOURCE: source,
        CC_TOOL_SESSION_HISTORY_DB: indexDbPath,
        CC_TOOL_SESSION_HISTORY_FORCE: options.force === true ? '1' : '0',
        CC_TOOL_SESSION_HISTORY_CHILD: '1'
      },
      silent: true,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Inventory worker for ${source} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (msg && msg.type === 'done') {
        resolve();
      } else if (msg && msg.type === 'error') {
        reject(new Error(msg.message || 'Inventory worker failed'));
      } else {
        resolve();
      }
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Inventory worker exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function attachWorkerHandler() {
  const source = process.env.CC_TOOL_SESSION_HISTORY_SOURCE;
  const dbPath = process.env.CC_TOOL_SESSION_HISTORY_DB;
  const force = process.env.CC_TOOL_SESSION_HISTORY_FORCE === '1';

  if (!source || !dbPath) {
    process.exit(1);
  }

  const { createSessionHistoryIndex } = require('./session-history-index');
  const index = createSessionHistoryIndex({ dbPath });

  index.ensureSourceIndexed(source, { consistency: 'complete', force })
    .then(() => {
      if (process.send) {
        process.send({ type: 'done' });
      }
      process.exit(0);
    })
    .catch((err) => {
      if (process.send) {
        process.send({ type: 'error', message: err.message });
      }
      process.exit(1);
    });
}

if (process.env.CC_TOOL_SESSION_HISTORY_WORKER === '1' || require.main === module) {
  attachWorkerHandler();
}

module.exports = { runInventoryWorker };
