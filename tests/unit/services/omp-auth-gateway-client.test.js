const http = require('http');
const {
  probeOmpAuthGateways
} = require('../../../src/server/services/omp-auth-gateway-client');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

it('marks only healthy official pi-native OAuth gateways as supported without sending credentials', async () => {
  let authorization = null;
  const healthy = http.createServer((req, res) => {
    authorization = req.headers.authorization || null;
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true,"version":"1.2.3"}');
      return;
    }
    res.writeHead(404).end();
  });
  const unhealthy = http.createServer((_req, res) => {
    res.writeHead(503).end();
  });
  const healthyPort = await listen(healthy);
  const unhealthyPort = await listen(unhealthy);

  try {
    const result = await probeOmpAuthGateways([
      {
        id: 'healthy',
        authMode: 'oauth',
        baseUrl: `http://127.0.0.1:${healthyPort}/v1`,
        apiKey: 'must-not-be-sent-to-healthz',
        providerConfig: { transport: 'pi-native' }
      },
      {
        id: 'unhealthy',
        authMode: 'oauth',
        baseUrl: `http://127.0.0.1:${unhealthyPort}/v1`,
        apiKey: 'gateway-token',
        providerConfig: { transport: 'pi-native' }
      },
      {
        id: 'api-key',
        authMode: 'api_key',
        baseUrl: 'https://api.example',
        apiKey: 'upstream-key'
      }
    ], { timeoutMs: 1000 });

    expect(result.supportedOAuthChannelIds).toEqual(['healthy']);
    expect(result.warnings).toEqual([
      expect.stringContaining('"unhealthy" is unavailable')
    ]);
    expect(authorization).toBeNull();
  } finally {
    await close(healthy);
    await close(unhealthy);
  }
});
