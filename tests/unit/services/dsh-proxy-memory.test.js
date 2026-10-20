const http = require('http');
const MODULE = require.resolve('../../../src/platforms/drivers/dsh/proxy-implementation');
let originals;
let implementation;
let upstream;
let channel;
let received;
let release;

function stub(module, exports) {
  const id = require.resolve(module);
  originals.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

function send(port, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

beforeEach(async () => {
  originals = new Map();
  received = null;
  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { received = Buffer.concat(chunks).toString('utf8'); res.end('{"ok":true}'); });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  channel = { id: 'dsh-test', name: 'DSH Test', providerApi: 'openai-completions',
    baseUrl: `http://127.0.0.1:${upstream.address().port}`, authMode: 'none', modelRedirects: [] };
  release = vi.fn();
  stub('../../../src/server/services/channel-scheduler', {
    allocateChannel: vi.fn(async options => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return channel;
    }), releaseChannel: release, getSchedulerState: () => ({})
  });
  stub('../../../src/server/websocket-server', { broadcastSchedulerState: vi.fn() });
  stub('../../../src/server/services/channel-health', { recordSuccess: vi.fn(), recordFailure: vi.fn() });
  stub('../../../src/config/loader', { loadConfig: () => ({ ports: {} }) });
  stub('../../../src/platforms/drivers/dsh/channels-implementation', {
    getEnabledChannels: () => [channel], getEffectiveApiKey: () => '', readActiveMarker: () => null,
    setDshProxyConfig: vi.fn(), restoreDshNativeConfig: vi.fn(), clearActiveMarker: vi.fn(), isProxyModeEnabled: () => false
  });
  stub('../../../src/server/services/request-logger', { persistProxyRequestSnapshot: vi.fn() });
  stub('../../../src/server/services/proxy-runtime', {
    saveProxyStartTime: vi.fn(), clearProxyStartTime: vi.fn(), getProxyStartTime: () => null, getProxyRuntime: () => ({})
  });
  originals.set(MODULE, require.cache[MODULE]);
  delete require.cache[MODULE];
  implementation = require(MODULE);
});

afterEach(async () => {
  await implementation.stopDshProxyServer();
  await new Promise(resolve => upstream.close(resolve));
  require('../../../src/server/services/memory-pressure').stopMemoryPressureMonitor();
  vi.restoreAllMocks();
  for (const [id, original] of originals) {
    if (original) require.cache[id] = original;
    else delete require.cache[id];
  }
});

test('preserves the original request bytes when no model or stream setting changes', async () => {
  const { port } = await implementation.startDshProxyServer({ port: 0 });
  const body = '{\n  "model": "same", "messages": []\n}';
  expect((await send(port, body)).status).toBe(200);
  expect(received).toBe(body);
  expect(release).toHaveBeenCalledTimes(1);
});

test('reserializes only after applying a model redirect or stream usage setting', async () => {
  channel.modelRedirects = [{ from: 'original', to: 'redirected' }];
  const { port } = await implementation.startDshProxyServer({ port: 0 });
  expect((await send(port, '{"model":"original","stream":true}')).status).toBe(200);
  expect(JSON.parse(received)).toMatchObject({ model: 'redirected', stream_options: { include_usage: true } });
  expect(release).toHaveBeenCalledTimes(1);
});

test('protects new requests under pressure before parsing their body', async () => {
  const { port } = await implementation.startDshProxyServer({ port: 0 });
  vi.spyOn(process, 'memoryUsage').mockReturnValue({ rss: 380 * 1024 * 1024 });
  const result = await send(port, '{ malformed');
  expect(result.status).toBe(503);
  expect(result.headers['retry-after']).toBe('5');
  expect(JSON.parse(result.body).error.code).toBe('memory_pressure');
  expect(received).toBeNull();
  expect(release).not.toHaveBeenCalled();
});
