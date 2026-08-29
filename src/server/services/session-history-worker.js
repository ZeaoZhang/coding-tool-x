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

const MAX_SERIALIZED_OBJECT_DEPTH = 6;
const MAX_SERIALIZED_OBJECT_KEYS = 32;
const MAX_SERIALIZED_ARRAY_LENGTH = 64;

function _safeStructuredValue(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value) || typeof value !== 'number' ? value : undefined;
  }
  if (typeof value === 'string') {
    return _safeErrorText(value);
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  if (depth >= MAX_SERIALIZED_OBJECT_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items = [];
    for (const item of value.slice(0, MAX_SERIALIZED_ARRAY_LENGTH)) {
      const safeItem = _safeStructuredValue(item, depth + 1);
      if (safeItem !== undefined) {
        items.push(safeItem);
      }
    }
    return items;
  }

  const result = {};
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (count >= MAX_SERIALIZED_OBJECT_KEYS) break;
    const safeItem = _safeStructuredValue(item, depth + 1);
    if (safeItem !== undefined) {
      result[_safeErrorText(key)] = safeItem;
      count += 1;
    }
  }
  return result;
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
  if (typeof error.status === 'string') serialized.status = _safeErrorText(error.status);
  const failure = _safeStructuredValue(error.failure);
  if (failure && typeof failure === 'object' && !Array.isArray(failure)) serialized.failure = failure;
  const context = _safeStructuredValue(error.context);
  if (context && typeof context === 'object' && !Array.isArray(context)) serialized.context = context;
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
  if (typeof payload.status === 'string') error.status = _safeErrorText(payload.status);
  const failure = _safeStructuredValue(payload.failure);
  if (failure && typeof failure === 'object' && !Array.isArray(failure)) error.failure = failure;
  const context = _safeStructuredValue(payload.context);
  if (context && typeof context === 'object' && !Array.isArray(context)) error.context = context;
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

    let stderr = '';
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

    if (child.stdout && typeof child.stdout.resume === 'function') {
      child.stdout.resume();
    }
    if (child.stderr) {
      if (typeof child.stderr.on === 'function') {
        child.stderr.on('data', (chunk) => {
          stderr = `${stderr}${chunk.toString()}`.slice(-MAX_SERIALIZED_ERROR_TEXT_LENGTH);
        });
      }
      if (typeof child.stderr.resume === 'function') child.stderr.resume();
    }

    let settled = false;
    let timer = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      if (!child.killed) {
        child.kill('SIGTERM');
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    timer = setTimeout(() => {
      finish(new Error(`Inventory worker for ${source} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('message', (msg) => {
      if (msg && msg.type === 'done') {
        finish();
      } else if (msg && msg.type === 'error') {
        finish(_deserializeWorkerError(msg.error || { message: msg.message }, 'Inventory worker failed'));
      } else {
        finish(new Error(`Inventory worker protocol error: unknown message from ${source}`));
      }
    });

    child.on('exit', (code) => {
      if (settled) return;
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : '';
      if (code === 0) {
        finish(new Error(`Inventory worker protocol error: exited before done for ${source}${suffix}`));
      } else {
        finish(new Error(`Inventory worker exited with code ${code}${suffix}`));
      }
    });

    child.on('error', (err) => {
      finish(err);
    });
  });
}

function attachWorkerHandler() {
  const source = process.env.CC_TOOL_SESSION_HISTORY_SOURCE;
  const dbPath = process.env.CC_TOOL_SESSION_HISTORY_DB;
  const force = process.env.CC_TOOL_SESSION_HISTORY_FORCE === '1';
  if (!source || !dbPath) {
    process.exit(1);
    return;
  }

  const { createSessionHistoryIndex } = require('./session-history-index');
  const index = createSessionHistoryIndex({ dbPath });

  index.ensureSourceIndexed(source, { consistency: 'complete', force })
    .then(() => _sendWorkerMessage({ type: 'done' }, 0))
    .catch((err) => _sendWorkerMessage({ type: 'error', error: _serializeWorkerError(err) }, 1));
}

function _sendWorkerMessage(message, exitCode, send, exit = process.exit) {
  let exited = false;
  const finish = (code) => {
    if (exited) return;
    exited = true;
    exit(code);
  };

  const sendImpl = send || (typeof process.send === 'function' ? process.send.bind(process) : null);
  if (!sendImpl) {
    finish(exitCode);
    return;
  }

  try {
    sendImpl(message, (callbackError) => {
      if (callbackError) {
        finish(exitCode || 1);
        return;
      }
      finish(exitCode);
    });
  } catch (_error) {
    finish(exitCode || 1);
  }
}

if (process.env.CC_TOOL_SESSION_HISTORY_WORKER === '1' || require.main === module) {
  attachWorkerHandler();
}

module.exports = {
  runInventoryWorker,
  attachWorkerHandler,
  _test: {
    serializeWorkerError: _serializeWorkerError,
    deserializeWorkerError: _deserializeWorkerError,
    sendWorkerMessage: _sendWorkerMessage,
    createSessionHistoryIndex: (...args) => require('./session-history-index').createSessionHistoryIndex(...args)
  }
};
