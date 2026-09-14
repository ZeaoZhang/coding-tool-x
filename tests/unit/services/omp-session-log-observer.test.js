const OMP_OBSERVER_MODULE = require.resolve('../../../src/platforms/drivers/omp/session-log-observer');
const OMP_SESSIONS_MODULE = require.resolve('../../../src/platforms/drivers/omp/sessions-implementation');
const OMP_CHANNELS_MODULE = require.resolve('../../../src/platforms/drivers/omp/channels-implementation');
const OMP_SETTINGS_MODULE = require.resolve('../../../src/platforms/drivers/omp/native-config-implementation');
const CONFIG_LOADER_MODULE = require.resolve('../../../src/config/loader');
const EVENT_BUS_MODULE = require.resolve('../../../src/plugins/event-bus');
const PROXY_LOG_HELPER_MODULE = require.resolve('../../../src/server/services/proxy-log-helper');
const WEBSOCKET_MODULE = require.resolve('../../../src/server/websocket-server');

let usageEvents;
let createOmpUsageEventCursor;
let getEnabledChannels;
let broadcastLog;
let normalizeNativeCliLogs;
let eventBusOn;
let eventBusOff;
let configSavedListener;

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

function emitConfigSaved(config) {
  configSavedListener?.({ config });
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
  createOmpUsageEventCursor = vi.fn(() => {
    let baseline = true;
    let seenKeys = new Set();
    const read = vi.fn(() => {
      const pending = usageEvents.filter((event) => {
        const key = event.key || event.id;
        return !seenKeys.has(key);
      });
      pending.forEach(event => seenKeys.add(event.key || event.id));
      if (baseline) {
        baseline = false;
        return [];
      }
      return pending;
    });
    return {
      read,
      reset: vi.fn(() => {
        baseline = true;
        seenKeys = new Set();
      })
    };
  });
  getEnabledChannels = vi.fn(() => [{
    id: 'channel-demo',
    name: 'Demo Channel',
    providerKey: 'demo',
    enabled: true
  }]);
  broadcastLog = vi.fn();
  normalizeNativeCliLogs = vi.fn((value, fallback = { omp: { enabled: true, intervalSeconds: 5 } }) => {
    const input = value?.omp || {};
    const base = fallback?.omp || { enabled: true, intervalSeconds: 5 };
    return {
      omp: {
        enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
        intervalSeconds: Number.isInteger(input.intervalSeconds)
          && input.intervalSeconds >= 1
          && input.intervalSeconds <= 60
          ? input.intervalSeconds
          : base.intervalSeconds
      }
    };
  });
  configSavedListener = null;
  eventBusOn = vi.fn((event, listener) => {
    if (event === 'config:saved') configSavedListener = listener;
  });
  eventBusOff = vi.fn((event, listener) => {
    if (event === 'config:saved' && configSavedListener === listener) {
      configSavedListener = null;
    }
  });

  delete require.cache[OMP_OBSERVER_MODULE];
  injectStub(OMP_SESSIONS_MODULE, { createOmpUsageEventCursor });
  injectStub(OMP_CHANNELS_MODULE, { getEnabledChannels });
  injectStub(OMP_SETTINGS_MODULE, {
    getManagedProviderId: channel => `ctx-${channel.providerKey}`,
    isManagedProviderId: value => String(value || '').startsWith('ctx-'),
    normalizeProviderId: value => String(value || '').trim().toLowerCase()
  });
  injectStub(CONFIG_LOADER_MODULE, { normalizeNativeCliLogs });
  injectStub(EVENT_BUS_MODULE, { on: eventBusOn, off: eventBusOff });
  injectStub(PROXY_LOG_HELPER_MODULE, {
    buildSuccessLogPayload: vi.fn(data => ({ type: 'log', status: 'success', ...data })),
    hasMeaningfulUsage: vi.fn((_source, tokens) => Number(tokens?.total) > 0)
  });
  injectStub(WEBSOCKET_MODULE, { broadcastLog });
});

afterEach(() => {
  const cached = require.cache[OMP_OBSERVER_MODULE];
  cached?.exports?.shutdownOmpSessionLogObserver?.();
  [
    OMP_OBSERVER_MODULE,
    OMP_SESSIONS_MODULE,
    OMP_CHANNELS_MODULE,
    OMP_SETTINGS_MODULE,
    CONFIG_LOADER_MODULE,
    EVENT_BUS_MODULE,
    PROXY_LOG_HELPER_MODULE,
    WEBSOCKET_MODULE
  ].forEach(modulePath => delete require.cache[modulePath]);
  vi.useRealTimers();
});

it('does not create a cursor or publish events while disabled', () => {
  const observer = loadObserver();
  observer.configureOmpSessionLogObserver({ enabled: false });

  expect(createOmpUsageEventCursor).not.toHaveBeenCalled();
  expect(observer._test.getOmpSessionLogObserverStatus()).toEqual({
    running: false,
    enabled: false,
    intervalMs: 5000,
    cursor: false
  });
  observer.pollOmpSessionLogs();
  expect(broadcastLog).not.toHaveBeenCalled();
});

it('publishes native events when no dynamic OMP proxy is running', () => {
  const observer = loadObserver();
  observer.configureOmpSessionLogObserver({ intervalMs: 1000 });
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

it('keeps one timer and cursor across idempotent and interval-only configuration', () => {
  const observer = loadObserver();
  observer.configureOmpSessionLogObserver({ intervalMs: 1000 });
  observer.configureOmpSessionLogObserver({ intervalMs: 1000 });
  expect(createOmpUsageEventCursor).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);

  observer.configureOmpSessionLogObserver({ intervalMs: 2000 });

  expect(createOmpUsageEventCursor).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  expect(observer._test.getOmpSessionLogObserverStatus()).toEqual({
    running: true,
    enabled: true,
    intervalMs: 2000,
    cursor: true
  });
});

it('applies config:saved changes and establishes a new baseline after re-enabling', () => {
  const observer = loadObserver();
  observer.configureOmpSessionLogObserver({ intervalMs: 1000 });
  expect(eventBusOn).toHaveBeenCalledTimes(1);

  emitConfigSaved({
    nativeCliLogs: { omp: { enabled: false, intervalSeconds: 12 } }
  });
  expect(observer._test.getOmpSessionLogObserverStatus()).toEqual({
    running: false,
    enabled: false,
    intervalMs: 12000,
    cursor: false
  });

  usageEvents = [
    ...usageEvents,
    {
      key: '/sessions/a.jsonl:while-disabled',
      id: 'omp-session-a:while-disabled',
      provider: 'native-provider',
      model: 'gpt-disabled',
      usage: { total: 4 }
    }
  ];
  observer.pollOmpSessionLogs();
  expect(broadcastLog).not.toHaveBeenCalled();

  emitConfigSaved({
    nativeCliLogs: { omp: { enabled: true, intervalSeconds: 3 } }
  });
  expect(createOmpUsageEventCursor).toHaveBeenCalledTimes(2);
  expect(observer._test.getOmpSessionLogObserverStatus()).toEqual({
    running: true,
    enabled: true,
    intervalMs: 3000,
    cursor: true
  });

  usageEvents = [
    ...usageEvents,
    {
      key: '/sessions/a.jsonl:after-enable',
      id: 'omp-session-a:after-enable',
      provider: 'native-provider',
      model: 'gpt-enabled',
      usage: { total: 5 }
    }
  ];
  observer.pollOmpSessionLogs();

  expect(broadcastLog).toHaveBeenCalledTimes(1);
  expect(broadcastLog).toHaveBeenCalledWith(expect.objectContaining({
    requestId: 'omp-session-a:after-enable',
    model: 'gpt-enabled'
  }));
});

it('changes only the timer when config:saved changes the interval', () => {
  const observer = loadObserver();
  observer.configureOmpSessionLogObserver({ intervalMs: 1000 });
  emitConfigSaved({
    nativeCliLogs: { omp: { enabled: true, intervalSeconds: 7 } }
  });

  expect(createOmpUsageEventCursor).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  expect(observer._test.getOmpSessionLogObserverStatus().intervalMs).toBe(7000);
});

it('filters managed ctx providers but publishes other native providers', () => {
  const observer = loadObserver();
  observer.configureOmpSessionLogObserver();
  usageEvents = [
    ...usageEvents,
    {
      key: '/sessions/a.jsonl:a-managed',
      id: 'omp-session-a:a-managed',
      provider: 'ctx-demo',
      model: 'gpt-5',
      usage: { total: 7 }
    },
    {
      key: '/sessions/a.jsonl:a-native',
      id: 'omp-session-a:a-native',
      provider: 'native-provider',
      model: 'native-model',
      usage: { total: 8 }
    }
  ];

  observer.pollOmpSessionLogs();

  expect(broadcastLog).toHaveBeenCalledTimes(1);
  expect(broadcastLog).toHaveBeenCalledWith(expect.objectContaining({
    requestId: 'omp-session-a:a-native',
    channel: 'native-provider',
    model: 'native-model'
  }));
});

it('shutdown clears cursor, timer, and config listener idempotently', () => {
  const observer = loadObserver();
  observer.configureOmpSessionLogObserver();
  const listener = configSavedListener;
  const cursor = createOmpUsageEventCursor.mock.results[0].value;

  expect(() => observer.shutdownOmpSessionLogObserver()).not.toThrow();
  expect(cursor.reset).toHaveBeenCalledTimes(1);
  expect(eventBusOff).toHaveBeenCalledWith('config:saved', listener);
  expect(observer._test.getOmpSessionLogObserverStatus()).toEqual({
    running: false,
    enabled: false,
    intervalMs: 5000,
    cursor: false
  });
  expect(() => observer.shutdownOmpSessionLogObserver()).not.toThrow();
  expect(eventBusOff).toHaveBeenCalledTimes(1);
});
