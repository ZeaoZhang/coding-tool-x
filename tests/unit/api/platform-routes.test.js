const express = require('express');
const http = require('http');
const createPlatformApiRouter = require('../../../src/server/api/platform-routes');

function request(app, url) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const req = http.request({ hostname: '127.0.0.1', port, path: url }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, body }));
        });
      });
      req.on('error', error => server.close(() => reject(error)));
      req.end();
    });
  });
}


describe('platform-routes', () => {
  it('mounts configured prefixes and only configured root aliases', async () => {
    const route = {
      method: 'GET',
      path: '/probe',
      capability: 'probe',
      operation: 'probe',
      request: 'default',
      response: 'default'
    };
    const registry = {
      list: () => [
        { key: 'claude', capabilities: { probe: 'fake-probe' }, api: { prefix: 'claude', rootAlias: true, rootAliasPaths: ['probe'], routes: [route] } },
        { key: 'codex', capabilities: { probe: 'fake-probe' }, api: { prefix: 'codex', routes: [route] } }
      ]
    };
    const runtime = {
      getDriver: (_platform, capability) => capability === 'probe'
        ? { probe: async context => ({ status: 'ok', data: { platform: context.platform } }) }
        : null
    };
    const app = express();
    app.use('/api', createPlatformApiRouter({ registry, runtime }));

    await expect(request(app, '/api/claude/probe')).resolves.toMatchObject({
      status: 200,
      body: JSON.stringify({ platform: 'claude' })
    });
    await expect(request(app, '/api/codex/probe')).resolves.toMatchObject({
      status: 200,
      body: JSON.stringify({ platform: 'codex' })
    });
    await expect(request(app, '/api/probe')).resolves.toMatchObject({
      status: 200,
      body: JSON.stringify({ platform: 'claude' })
    });
  });

  it('skips enabled manifests without an API driver', async () => {
    const registry = {
      list: () => [{ key: 'custom', api: { prefix: 'custom' } }]
    };
    const app = express();
    app.use('/api', createPlatformApiRouter({
      registry,
      runtime: { getDriver: () => null }
    }));

    await expect(request(app, '/api/custom/probe')).resolves.toMatchObject({ status: 404 });
  });
});
