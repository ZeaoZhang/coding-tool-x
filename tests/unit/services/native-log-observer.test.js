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
  delete process.env.CC_TOOL_MEMORY_TRACE;
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

test('resolves configured channels from native metadata for all supported CLIs', () => {
  const statistics = {
    recordRequest: vi.fn()
  };
  const channelsByPlatform = {
    claude: [{ id: 'claude-deepseek', name: 'Claude DeepSeek', providerKey: 'deepseek', enabled: true, model: 'claude-sonnet' }],
    codex: [{ id: 'codex-foxcode', name: 'Codex Foxcode', providerKey: 'foxcode', enabled: true }],
    gemini: [{ id: 'gemini-vertex', name: 'Gemini Vertex', providerKey: 'vertex', enabled: true }],
    opencode: [{ id: 'opencode-byok', name: 'OpenCode BYOK', providerKey: 'open-design-byok', enabled: true }],
    omp: [{ id: 'omp-shuai', name: 'OMP Shuai', providerKey: 'omp-provider', enabled: true }]
  };
  const runtime = {
    getDriver: vi.fn((platform, capability) => {
      if (capability === 'statistics') return statistics;
      if (capability === 'channels') {
        return {
          list: vi.fn(() => ({ status: 'ok', data: { channels: channelsByPlatform[platform] } }))
        };
      }
      return null;
    })
  };

  const events = [
    ['claude', { id: 'claude-event', provider: '', model: 'claude-sonnet', tokens: { input: 1, output: 1 } }],
    ['codex', { id: 'codex-event', channel: 'Unknown', provider: 'foxcode', model: 'gpt-5', tokens: { input: 1, output: 1 } }],
    ['gemini', { id: 'gemini-event', provider: '', model: 'gemini-3.1-pro-preview', tokens: { input: 1, output: 1 } }],
    ['opencode', { id: 'opencode-event', provider: 'open-design-byok', model: 'gpt-5.6-luna', tokens: { input: 1, output: 1 } }],
    ['omp', { id: 'omp-event', provider: 'omp-provider', model: 'claude-sonnet', tokens: { input: 1, output: 1 } }]
  ];

  events.forEach(([platform, event]) => {
    observer._test.recordEvent(platform, event, runtime);
  });

  expect(broadcastLog.mock.calls.map(([payload]) => [payload.source, payload.channel])).toEqual([
    ['claude', 'Claude DeepSeek'],
    ['codex', 'Codex Foxcode'],
    ['gemini', 'Gemini Vertex'],
    ['opencode', 'OpenCode BYOK'],
    ['omp', 'OMP Shuai']
  ]);
  expect(statistics.recordRequest.mock.calls.map(([request]) => request.channelId)).toEqual([
    'claude-deepseek',
    'codex-foxcode',
    'gemini-vertex',
    'opencode-byok',
    'omp-shuai'
  ]);
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
  expect(nativeDriver.createNativeLogCursor).toHaveBeenCalledWith({ skipInitialParse: true });
  expect(cursor.initialize).toHaveBeenCalledTimes(1);

  observer.pollNativeCliLogs({ runtime, registry });
  expect(cursor.readNewEvents).toHaveBeenCalledTimes(1);
  expect(statistics.recordRequest).toHaveBeenCalledTimes(1);
  expect(broadcastLog).toHaveBeenCalledTimes(1);
});

test('prepares cursors without polling and starts them only when requested', () => {
  const statistics = { recordRequest: vi.fn() };
  const cursor = {
    initialize: vi.fn(),
    readNewEvents: vi.fn(() => []),
    close: vi.fn()
  };
  const nativeDriver = { createNativeLogCursor: vi.fn(() => cursor) };
  const runtime = makeRuntime(statistics, nativeDriver);
  const registry = { list: vi.fn(() => [{ key: 'claude' }]) };

  const prepared = observer.prepareNativeCliLogObserver({ enabled: true, runtime, registry });
  expect(prepared.state).toBe('prepared');
  expect(cursor.readNewEvents).not.toHaveBeenCalled();

  const started = observer.startNativeCliLogObserver({ runtime, registry, pollImmediately: true });
  expect(started.state).toBe('running');
  expect(cursor.readNewEvents).toHaveBeenCalledTimes(1);
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

test('memory tracing reports per-platform cursor phases and bounded reader counters without log content', () => {
  process.env.CC_TOOL_MEMORY_TRACE = '1';
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const statistics = { recordRequest: vi.fn() };
  const cursor = {
    initialize: vi.fn(),
    readNewEvents: vi.fn(() => []),
    close: vi.fn()
  };
  const nativeDriver = {
    createNativeLogCursor: vi.fn(options => {
      options.onDiagnostic?.({ files: 2, bytesRead: 1234, parsedRecords: 7, maxLineLength: 256 });
      return cursor;
    })
  };
  const runtime = makeRuntime(statistics, nativeDriver);
  const registry = { list: vi.fn(() => [{ key: 'codex' }]) };

  observer.prepareNativeCliLogObserver({ enabled: true, runtime, registry });
  observer.pollNativeCliLogs({ runtime, registry });

  const records = log.mock.calls
    .map(([line]) => String(line))
    .filter(line => line.startsWith('[MEM] native-log '))
    .map(line => JSON.parse(line.slice('[MEM] native-log '.length)));
  expect(records.map(record => record.stage)).toEqual([
    'cursor-initialize-before',
    'cursor-initialize-after',
    'first-poll-before',
    'first-poll-after'
  ]);
  expect(records[1]).toEqual(expect.objectContaining({
    pid: process.pid,
    platform: 'codex',
    files: 2,
    bytesRead: 1234,
    parsedRecords: 7,
    maxLineLength: 256,
    rss: expect.any(Number),
    heapTotal: expect.any(Number),
    heapUsed: expect.any(Number),
    external: expect.any(Number),
    arrayBuffers: expect.any(Number)
  }));
  expect(records.every(record => !Object.prototype.hasOwnProperty.call(record, 'sessionId'))).toBe(true);
  log.mockRestore();
});
