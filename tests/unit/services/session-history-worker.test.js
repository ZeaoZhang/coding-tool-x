const childProcess = require('child_process');
const workerPath = require.resolve('../../../src/server/services/session-history-worker.js');
const sessionHistoryIndexPath = require.resolve('../../../src/server/services/session-history-index.js');
const worker = require(workerPath);


afterEach(() => {
  vi.restoreAllMocks();
});

describe('session-history-worker error IPC helpers', () => {
  it('round-trips structured inventory worker errors with typed context and cause', () => {
    const cause = new Error('adapter secret-free failure');
    cause.name = 'AdapterError';
    cause.code = 'E_ADAPTER';
    const error = new Error('Runtime sessions inventory failed on demo-cli: adapter secret-free failure');
    error.platform = 'demo-cli';
    error.capability = 'sessions';
    error.operation = 'inventory';
    error.code = 'E_INVENTORY';
    error.cause = cause;

    const serialized = worker._test.serializeWorkerError(error);
    expect(serialized).toEqual({
      message: 'Runtime sessions inventory failed on demo-cli: adapter secret-free failure',
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'inventory',
      code: 'E_INVENTORY',
      cause: {
        name: 'AdapterError',
        message: 'adapter secret-free failure',
        code: 'E_ADAPTER'
      }
    });

    const restored = worker._test.deserializeWorkerError(serialized, 'Inventory worker failed');
    expect(restored).toBeInstanceOf(Error);
    expect(restored.message).toContain('adapter secret-free failure');
    expect(restored.platform).toBe('demo-cli');
    expect(restored.capability).toBe('sessions');
    expect(restored.operation).toBe('inventory');
    expect(restored.code).toBe('E_INVENTORY');
    expect(restored.cause).toBeInstanceOf(Error);
    expect(restored.cause.name).toBe('AdapterError');
    expect(restored.cause.message).toBe('adapter secret-free failure');
    expect(restored.cause.code).toBe('E_ADAPTER');
  });
  it('round-trips structured inventory worker status, failure, and context safely', () => {
    const cause = new Error('adapter failed');
    cause.code = 'E_ADAPTER';
    const error = new Error('inventory failed');
    error.platform = 'demo-cli';
    error.capability = 'sessions';
    error.operation = 'inventory';
    error.status = 'failed';
    error.failure = {
      status: 'failed',
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'inventory',
      error: 'adapter failed',
      unsafe: () => 'drop me',
      nested: { bigint: 1n, keep: 'safe' }
    };
    error.context = {
      source: 'demo-cli',
      descriptors: ['a', 'b'],
      unsafe: Symbol('drop me'),
      nested: { keep: true, fn: () => null }
    };
    error.cause = cause;

    const serialized = worker._test.serializeWorkerError(error);
    expect(serialized.status).toBe('failed');
    expect(serialized.failure).toEqual({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'inventory',
      error: 'adapter failed',
      nested: { keep: 'safe' }
    });
    expect(serialized.context).toEqual({
      source: 'demo-cli',
      descriptors: ['a', 'b'],
      nested: { keep: true }
    });
    expect(() => JSON.stringify(serialized)).not.toThrow();

    const restored = worker._test.deserializeWorkerError(serialized);
    expect(restored.status).toBe('failed');
    expect(restored.failure).toEqual(serialized.failure);
    expect(restored.context).toEqual(serialized.context);
    expect(restored.platform).toBe('demo-cli');
    expect(restored.capability).toBe('sessions');
    expect(restored.operation).toBe('inventory');
    expect(restored.cause.code).toBe('E_ADAPTER');
  });


  it('bounds serialized error text and omits non-JSON-safe code values', () => {
    const longMessage = 'x'.repeat(5000);
    const cause = new Error(longMessage);
    cause.code = 1n;
    const error = new Error(longMessage);
    error.platform = 'demo-cli';
    error.capability = 'sessions';
    error.operation = 'inventory';
    error.code = { unsafe: true };
    error.cause = cause;

    const serialized = worker._test.serializeWorkerError(error);

    expect(serialized.message.length).toBeLessThanOrEqual(4097);
    expect(serialized.cause.message.length).toBeLessThanOrEqual(4097);
    expect(serialized).not.toHaveProperty('code');
    expect(serialized.cause).not.toHaveProperty('code');
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it('sanitizes untrusted IPC payloads when reconstructing structured errors', () => {
    const restored = worker._test.deserializeWorkerError({
      message: 'x'.repeat(5000),
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'inventory',
      code: { unsafe: true },
      cause: {
        name: 'AdapterError',
        message: 'y'.repeat(5000),
        code: () => 'E_UNSAFE'
      }
    });

    expect(restored.message.length).toBeLessThanOrEqual(4097);
    expect(restored.code).toBeUndefined();
    expect(restored.cause.message.length).toBeLessThanOrEqual(4097);
    expect(restored.cause.code).toBeUndefined();
  });

  it('reconstructs structured errors received from child IPC', async () => {
    const handlers = {};
    const child = {
      killed: false,
      kill: vi.fn(function () { child.killed = true; }),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
        return child;
      }),
      removeAllListeners: vi.fn()
    };
    vi.spyOn(childProcess, 'fork').mockReturnValue(child);

    const promise = worker.runInventoryWorker('demo-cli', '/tmp/history.sqlite', { force: true, timeoutMs: 1000 });
    handlers.message({
      type: 'error',
      error: {
        message: 'Runtime sessions inventory failed on demo-cli: adapter exploded',
        platform: 'demo-cli',
        capability: 'sessions',
        operation: 'inventory',
        code: 'E_INVENTORY',
        cause: {
          name: 'AdapterError',
          message: 'adapter exploded',
          code: 'E_ADAPTER'
        }
      }
    });

    const error = await promise.then(() => null, (err) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error.platform).toBe('demo-cli');
    expect(error.capability).toBe('sessions');
    expect(error.operation).toBe('inventory');
    expect(error.code).toBe('E_INVENTORY');
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.name).toBe('AdapterError');
    expect(error.cause.message).toBe('adapter exploded');
    expect(error.cause.code).toBe('E_ADAPTER');
  });
  it('rejects unknown child messages as protocol errors and cleans up', async () => {
    const handlers = {};
    const child = {
      killed: false,
      kill: vi.fn(function () { child.killed = true; }),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
        return child;
      }),
      removeAllListeners: vi.fn()
    };
    vi.spyOn(childProcess, 'fork').mockReturnValue(child);

    const promise = worker.runInventoryWorker('demo-cli', '/tmp/history.sqlite', { timeoutMs: 1000 });
    handlers.message({ type: 'progress' });

    const error = await promise.then(() => null, (err) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('protocol error');
    expect(error.message).toContain('unknown message');
    expect(child.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects child exit code 0 before an explicit done packet', async () => {
    const handlers = {};
    const child = {
      killed: false,
      kill: vi.fn(function () { child.killed = true; }),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
        return child;
      }),
      removeAllListeners: vi.fn()
    };
    vi.spyOn(childProcess, 'fork').mockReturnValue(child);

    const promise = worker.runInventoryWorker('demo-cli', '/tmp/history.sqlite', { timeoutMs: 1000 });
    handlers.exit(0);

    const error = await promise.then(() => null, (err) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('protocol error');
    expect(error.message).toContain('exited before done');
    expect(child.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('drains forked worker output streams before waiting for IPC', async () => {
    const handlers = {};
    const child = {
      killed: false,
      stdout: { resume: vi.fn() },
      stderr: { resume: vi.fn() },
      kill: vi.fn(function () { child.killed = true; }),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
        return child;
      }),
      removeAllListeners: vi.fn()
    };
    vi.spyOn(childProcess, 'fork').mockReturnValue(child);

    const promise = worker.runInventoryWorker('demo-cli', '/tmp/history.sqlite', { timeoutMs: 1000 });
    expect(child.stdout.resume).toHaveBeenCalledTimes(1);
    expect(child.stderr.resume).toHaveBeenCalledTimes(1);
    handlers.message({ type: 'done' });
    await expect(promise).resolves.toBeUndefined();
  });


  it('waits for structured error IPC to flush before exiting the worker process', () => {
    const exit = vi.fn();
    let sendCallback;
    const send = vi.fn((_payload, callback) => {
      expect(exit).not.toHaveBeenCalled();
      sendCallback = callback;
    });

    worker._test.sendWorkerMessage({
      type: 'error',
      error: {
        message: 'adapter exploded',
        platform: 'demo-cli',
        capability: 'sessions',
        operation: 'inventory'
      }
    }, 1, send, exit);

    expect(send).toHaveBeenCalledWith({
      type: 'error',
      error: expect.objectContaining({
        message: 'adapter exploded',
        platform: 'demo-cli',
        capability: 'sessions',
        operation: 'inventory'
      })
    }, expect.any(Function));
    expect(exit).not.toHaveBeenCalled();

    sendCallback();

    expect(exit).toHaveBeenCalledWith(1);
  });
  it('treats synchronous send throws as a failure and exits once', () => {
    const exit = vi.fn();
    const send = vi.fn(() => {
      throw new Error('send exploded');
    });

    worker._test.sendWorkerMessage({ type: 'done' }, 0, send, exit);

    expect(send).toHaveBeenCalledWith({ type: 'done' }, expect.any(Function));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('preserves a requested nonzero exit code when the send callback fails', () => {
    const exit = vi.fn();
    const send = vi.fn((_payload, callback) => {
      callback(new Error('callback exploded'));
    });

    worker._test.sendWorkerMessage({ type: 'error' }, 2, send, exit);

    expect(send).toHaveBeenCalledWith({ type: 'error' }, expect.any(Function));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(2);
  });

  it('centralizes parent cleanup for child error and exit paths', async () => {
    for (const event of ['error', 'exit']) {
      const handlers = {};
      const child = {
        killed: false,
        kill: vi.fn(function () { child.killed = true; }),
        on: vi.fn((name, handler) => {
          handlers[name] = handler;
          return child;
        }),
        removeAllListeners: vi.fn()
      };
      vi.spyOn(childProcess, 'fork').mockReturnValue(child);

      const promise = worker.runInventoryWorker('demo-cli', '/tmp/history.sqlite', { timeoutMs: 1000 });
      if (event === 'error') {
        handlers.error(new Error('spawn exploded'));
      } else {
        handlers.exit(1);
      }

      const error = await promise.then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(child.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    }
  });
  it('loads the session history index module before module.exports is assigned during worker boot', async () => {
    const originalWorkerCacheEntry = require.cache[workerPath];
    const originalSessionHistoryIndexCacheEntry = require.cache[sessionHistoryIndexPath];
    const originalEnv = {
      CC_TOOL_SESSION_HISTORY_WORKER: process.env.CC_TOOL_SESSION_HISTORY_WORKER,
      CC_TOOL_SESSION_HISTORY_SOURCE: process.env.CC_TOOL_SESSION_HISTORY_SOURCE,
      CC_TOOL_SESSION_HISTORY_DB: process.env.CC_TOOL_SESSION_HISTORY_DB,
      CC_TOOL_SESSION_HISTORY_FORCE: process.env.CC_TOOL_SESSION_HISTORY_FORCE,
      CC_TOOL_SESSION_HISTORY_CHILD: process.env.CC_TOOL_SESSION_HISTORY_CHILD
    };
    const ensureSourceIndexed = vi.fn(() => Promise.resolve());
    const createSessionHistoryIndex = vi.fn(() => ({ ensureSourceIndexed }));
    const send = vi.fn((_message, callback) => callback());
    const exit = vi.fn();
    const originalSend = process.send;
    const originalExit = process.exit;

    try {
      require.cache[sessionHistoryIndexPath] = {
        id: sessionHistoryIndexPath,
        filename: sessionHistoryIndexPath,
        loaded: true,
        exports: { createSessionHistoryIndex }
      };

      process.send = send;
      process.exit = exit;
      process.env.CC_TOOL_SESSION_HISTORY_WORKER = '1';
      process.env.CC_TOOL_SESSION_HISTORY_SOURCE = 'demo-cli';
      process.env.CC_TOOL_SESSION_HISTORY_DB = '/tmp/history.sqlite';
      process.env.CC_TOOL_SESSION_HISTORY_FORCE = '1';
      process.env.CC_TOOL_SESSION_HISTORY_CHILD = '1';

      delete require.cache[workerPath];
      expect(() => require(workerPath)).not.toThrow();

      await Promise.resolve();
      await Promise.resolve();

      expect(createSessionHistoryIndex).toHaveBeenCalledWith({ dbPath: '/tmp/history.sqlite' });
      expect(ensureSourceIndexed).toHaveBeenCalledWith('demo-cli', { consistency: 'complete', force: true });
      expect(send).toHaveBeenCalledWith({ type: 'done' }, expect.any(Function));
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      process.send = originalSend;
      process.exit = originalExit;

      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      if (originalSessionHistoryIndexCacheEntry) {
        require.cache[sessionHistoryIndexPath] = originalSessionHistoryIndexCacheEntry;
      } else {
        delete require.cache[sessionHistoryIndexPath];
      }

      if (originalWorkerCacheEntry) {
        require.cache[workerPath] = originalWorkerCacheEntry;
      } else {
        delete require.cache[workerPath];
      }
    }
  });
  it('completes production Worker startup without recursive child failure', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { spawnSync } = require('child_process');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-tool-x-worker-'));

    try {
      const dbPath = path.join(tempDir, 'history.sqlite');
      const projectsDir = path.join(tempDir, 'projects');
      fs.mkdirSync(projectsDir);
      const result = spawnSync(process.execPath, [
        '-e',
        `const { runInventoryWorker } = require(${JSON.stringify(workerPath)});
runInventoryWorker('codex', ${JSON.stringify(dbPath)}, {
  force: true,
  projectsDir: ${JSON.stringify(projectsDir)}
}).then(() => process.exit(0)).catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});`
      ], {
        env: { ...process.env, NODE_ENV: 'production', CC_TOOL_SESSION_HISTORY_CHILD: '0' },
        encoding: 'utf8',
        timeout: 10_000
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('runInventoryWorker is not a function');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
 });
