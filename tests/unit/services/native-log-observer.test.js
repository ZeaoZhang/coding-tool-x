'use strict';

const OBSERVER_PATH = require.resolve('../../../src/server/services/native-log-observer');
const RUNTIME_PATH = require.resolve('../../../src/platforms/runtime');
const WEBSOCKET_PATH = require.resolve('../../../src/server/websocket-server');

let observer;
let broadcastLog;

function injectStub(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  };
}

beforeEach(() => {
  broadcastLog = vi.fn();
  injectStub(WEBSOCKET_PATH, { broadcastLog });
  injectStub(RUNTIME_PATH, {
    getPlatformRuntime: vi.fn(),
    getPlatformRegistry: vi.fn()
  });
  delete require.cache[OBSERVER_PATH];
  observer = require(OBSERVER_PATH);
});

afterEach(() => {
  observer?.shutdownNativeCliLogObserver();
  delete require.cache[OBSERVER_PATH];
  delete require.cache[RUNTIME_PATH];
  delete require.cache[WEBSOCKET_PATH];
});

function makeRuntime(statistics, nativeDriver = null) {
  return {
    getDriver: vi.fn((platform, capability) => {
      if (capability === 'statistics') return statistics;
      if (capability === 'nativeLogs') return nativeDriver;
      return null;
    })
  };
}

test('records normalized native usage without touching channel health', () => {
  const statistics = { recordRequest: vi.fn() };
  const runtime = makeRuntime(statistics);

  expect(observer._test.recordEvent('codex', {
    id: 'session-1:token-count:150',
    sessionId: 'session-1',
    timestamp: '2026-09-14T01:02:03.000Z',
    model: 'gpt-5',
    tokens: { input: 40, output: 10, total: 50 }
  }, runtime)).toBe(true);

  expect(broadcastLog).toHaveBeenCalledWith(expect.objectContaining({
    type: 'log',
    status: 'success',
    source: 'codex',
    channel: 'Unknown',
    inputTokens: 40,
    outputTokens: 10,
    totalTokens: 50
  }));
  expect(statistics.recordRequest).toHaveBeenCalledWith(expect.objectContaining({
    id: 'session-1:token-count:150',
    channelId: undefined,
    tokens: expect.objectContaining({ total: 50 })
  }));
  expect(runtime.getDriver).toHaveBeenCalledWith('codex', 'statistics');
  expect(runtime.getDriver).not.toHaveBeenCalledWith('codex', 'health');
});

test('discovers native log cursors from registry capabilities and polls them', () => {
  const statistics = { recordRequest: vi.fn() };
  const cursor = {
    initialize: vi.fn(),
    readNewEvents: vi.fn(() => [{
      id: 'claude:session:assistant-1',
      sessionId: 'session',
      model: 'claude-sonnet',
      tokens: { input: 3, output: 2, total: 5 }
    }]),
    close: vi.fn()
  };
  const nativeDriver = { createNativeLogCursor: vi.fn(() => cursor) };
  const runtime = makeRuntime(statistics, nativeDriver);
  const registry = { list: vi.fn(() => [{ key: 'claude' }]) };

  observer.configureNativeCliLogObserver({ enabled: true, intervalSeconds: 60, runtime, registry });
  expect(nativeDriver.createNativeLogCursor).toHaveBeenCalledTimes(1);
  expect(cursor.initialize).toHaveBeenCalledTimes(1);

  observer.pollNativeCliLogs({ runtime, registry });
  expect(cursor.readNewEvents).toHaveBeenCalledTimes(1);
  expect(statistics.recordRequest).toHaveBeenCalledTimes(1);
  expect(broadcastLog).toHaveBeenCalledTimes(1);
});

test('does not publish or record zero-usage native records', () => {
  const statistics = { recordRequest: vi.fn() };
  const runtime = makeRuntime(statistics);

  expect(observer._test.recordEvent('gemini', {
    id: 'gemini:session:message-1',
    tokens: { input: 0, output: 0, total: 0 }
  }, runtime)).toBe(false);
  expect(broadcastLog).not.toHaveBeenCalled();
  expect(statistics.recordRequest).not.toHaveBeenCalled();
});
