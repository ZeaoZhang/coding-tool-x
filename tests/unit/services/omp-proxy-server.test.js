const CONFIG_LOADER_MODULE = require.resolve('../../../src/config/loader');
const PROXY_RUNTIME_MODULE = require.resolve('../../../src/server/services/proxy-runtime');
const OMP_CHANNELS_MODULE = require.resolve('../../../src/server/services/omp-channels');
const OMP_LOG_OBSERVER_MODULE = require.resolve('../../../src/server/services/omp-session-log-observer');
const OMP_PROXY_SERVER_MODULE = require.resolve('../../../src/server/omp-proxy-server');
const http = require('http');

let syncManagedOmpProviders;
let disableManagedOmpProviders;
let activateStaticOmpChannel;
let isManagedOmpModeEnabled;
let enableManagedOmpMode;
let disableManagedOmpMode;
let loadManagedOmpActiveChannelId;
let loadManagedOmpModeState;
let saveProxyStartTime;
let clearProxyStartTime;
let startOmpSessionLogObserver;
let stopOmpSessionLogObserver;
let getEnabledChannels;

function requestHealth(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/healthz'
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(body)
      }));
    });
    request.on('error', reject);
  });
}

function injectStub(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  };
}

beforeEach(() => {
  syncManagedOmpProviders = vi.fn(() => ({ warnings: [] }));
  disableManagedOmpProviders = vi.fn(() => ({ warnings: [] }));
  activateStaticOmpChannel = vi.fn(() => ({
    channel: { id: 'channel-a', name: 'OMP A' },
    sync: { warnings: [] }
  }));
  isManagedOmpModeEnabled = vi.fn(() => false);
  enableManagedOmpMode = vi.fn();
  disableManagedOmpMode = vi.fn();
  loadManagedOmpActiveChannelId = vi.fn(() => null);
  loadManagedOmpModeState = vi.fn(() => null);
  saveProxyStartTime = vi.fn();
  clearProxyStartTime = vi.fn();
  startOmpSessionLogObserver = vi.fn();
  stopOmpSessionLogObserver = vi.fn();
  getEnabledChannels = vi.fn(() => [{
    id: 'channel-a',
    name: 'OMP A',
    providerKey: 'openai',
    providerApi: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'upstream-secret',
    enabled: true,
    models: [{ id: 'gpt-5' }],
    model: 'gpt-5'
  }]);

  delete require.cache[OMP_PROXY_SERVER_MODULE];
  injectStub(CONFIG_LOADER_MODULE, {
    loadConfig: vi.fn(() => ({ ports: { ompProxy: 0 } }))
  });
  injectStub(PROXY_RUNTIME_MODULE, {
    saveProxyStartTime,
    clearProxyStartTime,
    getProxyStartTime: vi.fn(() => null),
    getProxyRuntime: vi.fn(() => null)
  });
  injectStub(OMP_CHANNELS_MODULE, {
    syncManagedOmpProviders,
    disableManagedOmpProviders,
    activateStaticOmpChannel,
    getEnabledChannels,
    isManagedOmpModeEnabled,
    enableManagedOmpMode,
    disableManagedOmpMode,
    loadManagedOmpActiveChannelId,
    loadManagedOmpModeState
  });
  injectStub(OMP_LOG_OBSERVER_MODULE, {
    startOmpSessionLogObserver,
    stopOmpSessionLogObserver,
    getOmpSessionLogObserverStatus: vi.fn(() => ({ running: false, seenEvents: 0 }))
  });
});

afterEach(async () => {
  const loadedProxy = require.cache[OMP_PROXY_SERVER_MODULE]?.exports;
  if (loadedProxy) {
    disableManagedOmpProviders.mockImplementation(() => ({ warnings: [] }));
    await loadedProxy.stopOmpProxyServer().catch(() => {});
  }
  [
    OMP_PROXY_SERVER_MODULE,
    OMP_LOG_OBSERVER_MODULE,
    OMP_CHANNELS_MODULE,
    PROXY_RUNTIME_MODULE,
    CONFIG_LOADER_MODULE
  ].forEach((modulePath) => {
    delete require.cache[modulePath];
  });
});

it('enables persistent managed mode before synchronizing providers', async () => {
  const proxy = require('../../../src/server/omp-proxy-server');

  const result = await proxy.startOmpProxyServer({ activeChannelId: 'channel-a' });

  expect(enableManagedOmpMode).toHaveBeenCalledWith('channel-a', expect.objectContaining({
    host: '127.0.0.1',
    port: result.port,
    secret: expect.any(String)
  }));
  expect(enableManagedOmpMode.mock.invocationCallOrder[0])
    .toBeLessThan(syncManagedOmpProviders.mock.invocationCallOrder[0]);
  expect(saveProxyStartTime).toHaveBeenCalledWith('omp', false);
  expect(startOmpSessionLogObserver).toHaveBeenCalledTimes(1);
  expect(result).toEqual(expect.objectContaining({
    success: true,
    port: expect.any(Number)
  }));
  expect(result.port).toBeGreaterThan(0);
  expect(proxy.getOmpProxyStatus()).toEqual(expect.objectContaining({
    running: true,
    listening: true,
    mode: 'http-gateway',
    port: result.port
  }));
  await expect(requestHealth(result.port)).resolves.toEqual({
    statusCode: 200,
    body: expect.objectContaining({ ok: true, service: 'omp-gateway' })
  });
});

it('hands off to one direct current provider before stopping the gateway', async () => {
  loadManagedOmpModeState.mockReturnValue({
    activeChannelId: 'channel-a',
    gateway: {
      host: '127.0.0.1',
      port: 20092,
      secret: 'gateway-secret'
    }
  });
  const proxy = require('../../../src/server/omp-proxy-server');
  await proxy.startOmpProxyServer({ activeChannelId: 'channel-a' });

  const result = await proxy.stopOmpProxyServer();

  expect(activateStaticOmpChannel).toHaveBeenCalledWith('channel-a');
  expect(activateStaticOmpChannel.mock.invocationCallOrder[0])
    .toBeLessThan(disableManagedOmpMode.mock.invocationCallOrder[0]);
  expect(disableManagedOmpProviders).not.toHaveBeenCalled();
  expect(disableManagedOmpMode).toHaveBeenCalledTimes(1);
  expect(clearProxyStartTime).toHaveBeenCalledWith('omp');
  expect(stopOmpSessionLogObserver).toHaveBeenCalledTimes(1);
  expect(result).toEqual(expect.objectContaining({
    success: true,
    port: expect.any(Number)
  }));
  expect(proxy.getOmpProxyStatus()).toEqual(expect.objectContaining({
    running: false,
    listening: false,
    port: null
  }));
});

it('rolls back newly enabled managed mode when provider synchronization fails', async () => {
  syncManagedOmpProviders.mockImplementation(() => {
    throw new Error('sync failed');
  });
  const proxy = require('../../../src/server/omp-proxy-server');

  await expect(proxy.startOmpProxyServer({ activeChannelId: 'channel-a' }))
    .rejects.toThrow('sync failed');

  expect(disableManagedOmpMode).toHaveBeenCalledTimes(1);
  expect(proxy.getOmpProxyStatus()).toEqual(expect.objectContaining({
    running: false,
    port: null
  }));
});

it('restores the previous active channel when resynchronization fails', async () => {
  isManagedOmpModeEnabled.mockReturnValue(true);
  loadManagedOmpActiveChannelId.mockReturnValue('channel-old');
  loadManagedOmpModeState.mockReturnValue({
    activeChannelId: 'channel-old',
    gateway: {
      host: '127.0.0.1',
      port: 20092,
      secret: 'old-secret'
    }
  });
  syncManagedOmpProviders.mockImplementation(() => {
    throw new Error('sync failed');
  });
  const proxy = require('../../../src/server/omp-proxy-server');

  await expect(proxy.startOmpProxyServer({ activeChannelId: 'channel-new' }))
    .rejects.toThrow('sync failed');

  expect(enableManagedOmpMode).toHaveBeenNthCalledWith(
    1,
    'channel-new',
    expect.objectContaining({ host: '127.0.0.1', port: expect.any(Number) })
  );
  expect(enableManagedOmpMode).toHaveBeenNthCalledWith(2, 'channel-old', {
    host: '127.0.0.1',
    port: 20092,
    secret: 'old-secret'
  });
  expect(disableManagedOmpMode).not.toHaveBeenCalled();
});

it('keeps managed mode active and resumes log observation when static handoff fails', async () => {
  loadManagedOmpModeState.mockReturnValue({
    activeChannelId: 'channel-a',
    gateway: {
      host: '127.0.0.1',
      port: 20092,
      secret: 'gateway-secret'
    }
  });
  activateStaticOmpChannel.mockImplementation(() => {
    throw new Error('handoff failed');
  });
  const proxy = require('../../../src/server/omp-proxy-server');
  await proxy.startOmpProxyServer({ activeChannelId: 'channel-a' });
  startOmpSessionLogObserver.mockClear();

  await expect(proxy.stopOmpProxyServer()).rejects.toThrow('handoff failed');

  expect(stopOmpSessionLogObserver).toHaveBeenCalledTimes(1);
  expect(startOmpSessionLogObserver).toHaveBeenCalledTimes(1);
  expect(disableManagedOmpMode).not.toHaveBeenCalled();
  expect(proxy.getOmpProxyStatus()).toEqual(expect.objectContaining({
    running: true,
    listening: true,
    port: expect.any(Number)
  }));
});
