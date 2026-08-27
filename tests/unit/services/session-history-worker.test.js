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

  it('reconstructs structured errors received from child IPC', async () => {
    const handlers = {};
    const child = {
      kill: vi.fn(),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
        return child;
      })
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
});
