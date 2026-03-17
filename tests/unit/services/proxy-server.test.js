// globals: true in vitest.config.js

const path = require('path');

const PROXY_SERVER_PATH = '../../../src/server/proxy-server';

// Modules to stub and their fake exports
const STUBS = [
  ['../../../src/server/services/channel-scheduler', {
    allocateChannel: vi.fn(),
    releaseChannel: vi.fn(),
    getSchedulerState: vi.fn(() => ({}))
  }],
  ['../../../src/server/services/channel-health', {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn()
  }],
  ['../../../src/server/websocket-server', {
    broadcastLog: vi.fn(),
    broadcastSchedulerState: vi.fn()
  }],
  ['../../../src/config/loader', {
    loadConfig: vi.fn(() => ({ ports: { proxy: 9960 } }))
  }],
  ['../../../src/config/default', {
    pricing: {
      claude: { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 }
    },
    ports: { proxy: 9960 }
  }],
  ['../../../src/server/utils/pricing', {
    resolveModelPricing: vi.fn(() => ({ input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 }))
  }],
  ['../../../src/server/services/statistics-service', {
    recordRequest: vi.fn()
  }],
  ['../../../src/server/services/proxy-runtime', {
    saveProxyStartTime: vi.fn(),
    clearProxyStartTime: vi.fn(),
    getProxyStartTime: vi.fn(() => null),
    getProxyRuntime: vi.fn(() => null)
  }],
  ['../../../src/server/services/response-decoder', {
    createDecodedStream: vi.fn((r) => r)
  }],
  ['../../../src/plugins/event-bus', {
    emit: vi.fn(),
    emitSync: vi.fn(),
    on: vi.fn()
  }],
  ['../../../src/server/services/channels', {
    getEffectiveApiKey: vi.fn(),
    getAllChannels: vi.fn(() => [])
  }],
  ['../../../src/server/services/request-logger', {
    persistProxyRequestSnapshot: vi.fn(),
    persistClaudeRequestTemplate: vi.fn(),
    loadClaudeRequestTemplate: vi.fn()
  }],
  ['../../../src/server/services/proxy-log-helper', {
    publishUsageLog: vi.fn(),
    publishFailureLog: vi.fn()
  }],
  ['../../../src/server/services/base/proxy-utils', {
    redirectModel: vi.fn((m) => ({ model: m, redirected: false }))
  }],
];

function resolvedStubs() {
  return STUBS.map(([mod, exports]) => [require.resolve(mod), exports]);
}

function injectStubs() {
  for (const [resolvedPath, exports] of resolvedStubs()) {
    require.cache[resolvedPath] = {
      id: resolvedPath,
      filename: resolvedPath,
      loaded: true,
      exports
    };
  }
}

function cleanStubs() {
  for (const [resolvedPath] of resolvedStubs()) {
    delete require.cache[resolvedPath];
  }
  delete require.cache[require.resolve(PROXY_SERVER_PATH)];
}

beforeEach(() => {
  injectStubs();
  delete require.cache[require.resolve(PROXY_SERVER_PATH)];
});

afterEach(() => {
  cleanStubs();
});

describe('proxy-server exports', () => {
  it('exports startProxyServer', () => {
    const mod = require(PROXY_SERVER_PATH);
    expect(mod).toHaveProperty('startProxyServer');
  });

  it('exports stopProxyServer', () => {
    const mod = require(PROXY_SERVER_PATH);
    expect(mod).toHaveProperty('stopProxyServer');
  });

  it('exports getProxyStatus', () => {
    const mod = require(PROXY_SERVER_PATH);
    expect(mod).toHaveProperty('getProxyStatus');
  });

  it('exports clearRedirectCache', () => {
    const mod = require(PROXY_SERVER_PATH);
    expect(mod).toHaveProperty('clearRedirectCache');
  });

  it('all four exports are functions', () => {
    const { startProxyServer, stopProxyServer, getProxyStatus, clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(typeof startProxyServer).toBe('function');
    expect(typeof stopProxyServer).toBe('function');
    expect(typeof getProxyStatus).toBe('function');
    expect(typeof clearRedirectCache).toBe('function');
  });
});

describe('getProxyStatus', () => {
  it('returns an object with a running field when server has not been started', () => {
    const { getProxyStatus } = require(PROXY_SERVER_PATH);
    const status = getProxyStatus();
    expect(status).not.toBeNull();
    expect(typeof status).toBe('object');
    expect(status).toHaveProperty('running');
  });

  it('running is false when server has not been started', () => {
    const { getProxyStatus } = require(PROXY_SERVER_PATH);
    const status = getProxyStatus();
    expect(status.running).toBe(false);
  });
});

describe('clearRedirectCache', () => {
  it('does not throw when called with a channel id string', () => {
    const { clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(() => clearRedirectCache('ch1')).not.toThrow();
  });

  it('does not throw when called with null', () => {
    const { clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(() => clearRedirectCache(null)).not.toThrow();
  });

  it('does not throw when called with undefined', () => {
    const { clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(() => clearRedirectCache(undefined)).not.toThrow();
  });

  it('does not throw when called with no arguments', () => {
    const { clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(() => clearRedirectCache()).not.toThrow();
  });
});
