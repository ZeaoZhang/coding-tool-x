'use strict';

const childProcess = require('child_process');
const path = require('path');

const WORKER_TIMEOUT_MS = 180000;
const MAX_SERIALIZED_ERROR_TEXT_LENGTH = 4096;

function _safeErrorText(value, fallback = '') {
  const text = value == null || value === '' ? fallback : String(value);
  return text.length > MAX_SERIALIZED_ERROR_TEXT_LENGTH
    ? `${text.slice(0, MAX_SERIALIZED_ERROR_TEXT_LENGTH)}…`
    : text;
}

function _safeCode(value) {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}


function _serializeCause(cause) {
  if (!cause) {
    return null;
  }
  const serialized = {
    name: _safeErrorText(cause.name, 'Error'),
    message: _safeErrorText(cause && cause.message ? cause.message : cause, 'Error')
  };
  const code = _safeCode(cause.code);
  if (code !== undefined) {
    serialized.code = code;
  }
  return serialized;
}

function _serializeWorkerError(error) {
  if (!error || typeof error !== 'object') {
    return { message: _safeErrorText(error, 'Inventory worker failed') };
  }
  const serialized = {
    message: _safeErrorText(error.message ? error.message : error, 'Inventory worker failed')
  };
  if (typeof error.platform === 'string') serialized.platform = _safeErrorText(error.platform);
  if (typeof error.capability === 'string') serialized.capability = _safeErrorText(error.capability);
  if (typeof error.operation === 'string') serialized.operation = _safeErrorText(error.operation);
  const code = _safeCode(error.code);
  if (code !== undefined) serialized.code = code;
  const cause = _serializeCause(error.cause);
  if (cause) {
    serialized.cause = cause;
  }
  return serialized;
}

function _deserializeCause(cause) {
  if (!cause) {
    return null;
  }
  if (cause instanceof Error) {
    return cause;
  }
  const error = new Error(_safeErrorText(cause.message ? cause.message : cause, 'Error'));
  if (cause.name) {
    error.name = _safeErrorText(cause.name, 'Error');
  }
  const code = _safeCode(cause.code);
  if (code !== undefined) {
    error.code = code;
  }
  return error;
}

function _deserializeWorkerError(payload, fallbackMessage = 'Inventory worker failed') {
  if (payload instanceof Error) {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return new Error(_safeErrorText(payload, fallbackMessage));
  }
  const error = new Error(_safeErrorText(payload.message ? payload.message : fallbackMessage, fallbackMessage));
  if (typeof payload.platform === 'string') error.platform = _safeErrorText(payload.platform);
  if (typeof payload.capability === 'string') error.capability = _safeErrorText(payload.capability);
  if (typeof payload.operation === 'string') error.operation = _safeErrorText(payload.operation);
  const code = _safeCode(payload.code);
  if (code !== undefined) error.code = code;
  const cause = _deserializeCause(payload.cause);
  if (cause) {
    error.cause = cause;
  }
  return error;
}


function runInventoryWorker(source, indexDbPath, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || WORKER_TIMEOUT_MS;
    const workerPath = path.resolve(__dirname, 'session-history-worker.js');

    const child = childProcess.fork(workerPath, [], {
      env: {
        ...process.env,
        CC_TOOL_SESSION_HISTORY_WORKER: '1',
        CC_TOOL_SESSION_HISTORY_SOURCE: source,
        CC_TOOL_SESSION_HISTORY_DB: indexDbPath,
        CC_TOOL_SESSION_HISTORY_FORCE: options.force === true ? '1' : '0',
        CC_TOOL_SESSION_HISTORY_CHILD: '1'
      },
      silent: true,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
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
        reject(_deserializeWorkerError(msg.error || { message: msg.message }, 'Inventory worker failed'));
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
        process.send({ type: 'error', error: _serializeWorkerError(err) });
      }
      process.exit(1);
    });
}

if (process.env.CC_TOOL_SESSION_HISTORY_WORKER === '1' || require.main === module) {
  attachWorkerHandler();
}

module.exports = {
  runInventoryWorker,
  _test: {
    serializeWorkerError: _serializeWorkerError,
    deserializeWorkerError: _deserializeWorkerError
  }
};
