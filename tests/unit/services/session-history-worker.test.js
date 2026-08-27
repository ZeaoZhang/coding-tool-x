const childProcess = require('child_process');
const worker = require('../../../src/server/services/session-history-worker.js');


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
});
