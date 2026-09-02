const OMP_OBSERVER_MODULE = require.resolve('../../../src/platforms/drivers/omp/session-log-observer');
const OMP_SESSIONS_MODULE = require.resolve('../../../src/platforms/drivers/omp/sessions-implementation');
const OMP_CHANNELS_MODULE = require.resolve('../../../src/platforms/drivers/omp/channels-implementation');
const OMP_SETTINGS_MODULE = require.resolve('../../../src/platforms/drivers/omp/native-config-implementation');
const PROXY_LOG_HELPER_MODULE = require.resolve('../../../src/server/services/proxy-log-helper');
const WEBSOCKET_MODULE = require.resolve('../../../src/server/websocket-server');

let usageEvents;
let createOmpUsageEventCursor;
let getEnabledChannels;
let broadcastLog;

function injectStub(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  };
}

function loadObserver() {
  return require('../../../src/platforms/drivers/omp/session-log-observer');
}

beforeEach(() => {
  vi.useFakeTimers();
  usageEvents = [{
    key: '/sessions/a.jsonl:a-old',
    id: 'omp-session-a:a-old',
    provider: 'ctx-demo',
    model: 'gpt-old',
    timestamp: '2026-07-27T01:00:00.000Z',
    usage: { input: 1, output: 2, total: 3, cost: 0.001 }
  }];
  createOmpUsageEventCursor = vi.fn(() => ({
    read: vi.fn(() => usageEvents),
    reset: vi.fn()
  }));
  getEnabledChannels = vi.fn(() => [{
    id: 'channel-demo',
    name: 'Demo Channel',
    providerKey: 'demo',
    enabled: true
  }]);
  broadcastLog = vi.fn();

  delete require.cache[OMP_OBSERVER_MODULE];
  injectStub(OMP_SESSIONS_MODULE, { createOmpUsageEventCursor });
  injectStub(OMP_CHANNELS_MODULE, { getEnabledChannels });
  injectStub(OMP_SETTINGS_MODULE, {
    getManagedProviderId: channel => `ctx-${channel.providerKey}`,
    isManagedProviderId: value => String(value || '').startsWith('ctx-'),
    normalizeProviderId: value => String(value || '').trim().toLowerCase()
  });
  injectStub(PROXY_LOG_HELPER_MODULE, {
    buildSuccessLogPayload: vi.fn(data => ({ type: 'log', status: 'success', ...data })),
    hasMeaningfulUsage: vi.fn((_source, tokens) => Number(tokens?.total) > 0)
  });
  injectStub(WEBSOCKET_MODULE, { broadcastLog });
});

afterEach(() => {
  const cached = require.cache[OMP_OBSERVER_MODULE];
  cached?.exports?.stopOmpSessionLogObserver?.();
  [
    OMP_OBSERVER_MODULE,
    OMP_SESSIONS_MODULE,
    OMP_CHANNELS_MODULE,
    OMP_SETTINGS_MODULE,
    PROXY_LOG_HELPER_MODULE,
    WEBSOCKET_MODULE
  ].forEach(modulePath => delete require.cache[modulePath]);
  vi.useRealTimers();
});

it('seeds existing OMP usage without replaying it, then logs each native event once', () => {
  const observer = loadObserver();
  observer.startOmpSessionLogObserver();

  expect(broadcastLog).not.toHaveBeenCalled();

  usageEvents = [
    ...usageEvents,
    {
      key: '/sessions/a.jsonl:a-new',
      id: 'omp-session-a:a-new',
      provider: 'native-provider',
      model: 'gpt-new',
      timestamp: '2026-07-27T01:01:00.000Z',
      usage: {
        input: 10,
        output: 20,
        cached: 4,
        reasoning: 5,
        total: 39,
        cost: 0.25
      }
    }
  ];

  observer.pollOmpSessionLogs();
  observer.pollOmpSessionLogs();

  expect(broadcastLog).toHaveBeenCalledTimes(1);
  expect(broadcastLog).toHaveBeenCalledWith(expect.objectContaining({
    source: 'omp',
    requestId: 'omp-session-a:a-new',
    channel: 'native-provider',
    model: 'gpt-new',
    tokens: expect.objectContaining({
      input: 10,
      output: 20,
      cached: 4,
      reasoning: 5,
      total: 39
    }),
    cost: 0.25,
    timestamp: new Date('2026-07-27T01:01:00.000Z').getTime()
  }));
});

it('does not duplicate managed ctx usage already published by the HTTP gateway', () => {
  const observer = loadObserver();
  observer.startOmpSessionLogObserver();
  usageEvents = [
    ...usageEvents,
    {
      key: '/sessions/a.jsonl:a-managed',
      id: 'omp-session-a:a-managed',
      provider: 'ctx-demo',
      model: 'gpt-5',
      usage: { input: 3, output: 4, total: 7 }
    }
  ];

  observer.pollOmpSessionLogs();

  expect(broadcastLog).not.toHaveBeenCalled();
});

it('uses the actual OMP provider when no managed channel matches', () => {
  getEnabledChannels.mockReturnValue([]);
  const observer = loadObserver();
  observer.startOmpSessionLogObserver();
  usageEvents = [{
    key: '/sessions/b.jsonl:a1',
    id: 'omp-session-b:a1',
    provider: 'native-provider',
    model: 'native-model',
    timestamp: '2026-07-27T02:00:00.000Z',
    usage: { input: 3, output: 4, total: 7 }
  }];

  observer.pollOmpSessionLogs();

  expect(broadcastLog).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'native-provider',
    model: 'native-model'
  }));
});

it('stops polling after managed OMP mode is disabled', () => {
  const observer = loadObserver();
  observer.startOmpSessionLogObserver({ intervalMs: 1000 });
  observer.stopOmpSessionLogObserver();
  usageEvents = [
    ...usageEvents,
    {
      key: '/sessions/a.jsonl:a-after-stop',
      id: 'omp-session-a:a-after-stop',
      provider: 'ctx-demo',
      model: 'gpt-new',
      usage: { input: 1, output: 1, total: 2 }
    }
  ];

  vi.advanceTimersByTime(5000);

  expect(createOmpUsageEventCursor).toHaveBeenCalledTimes(1);
  expect(broadcastLog).not.toHaveBeenCalled();
  expect(observer.getOmpSessionLogObserverStatus()).toEqual({
    running: false,
    seenEvents: 0
  });
});

it('bounds remembered event identifiers during long-running observation', () => {
  usageEvents = [];
  const observer = loadObserver();
  observer.startOmpSessionLogObserver({ maxSeenEvents: 2 });

  usageEvents = [1, 2, 3].map(index => ({
    key: `/sessions/a.jsonl:event-${index}`,
    id: `event-${index}`,
    provider: 'native-provider',
    model: 'gpt-5',
    usage: { total: index }
  }));
  observer.pollOmpSessionLogs();

  expect(observer.getOmpSessionLogObserverStatus()).toEqual({
    running: true,
    seenEvents: 2
  });
});
