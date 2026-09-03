'use strict';

const express = require('express');
const http = require('http');
const createPlatformRouter = require('../../../src/server/api/platforms');

function request(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        method,
        path: url,
        headers: body ? { 'content-type': 'application/json' } : undefined
      }, response => {
        let payload = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { payload += chunk; });
        response.on('end', () => server.close(() => resolve({ status: response.statusCode, body: JSON.parse(payload) })));
      });
      request.on('error', error => server.close(() => reject(error)));
      if (body) request.end(JSON.stringify(body));
      else request.end();
    });
  });
}

function manifest() {
  return {
    key: 'demo',
    label: 'Demo',
    command: 'demo',
    capabilities: { projects: 'fake-projects' },
    api: {
      prefix: 'demo',
      routes: [{
        path: '/projects',
        method: 'GET',
        capability: 'projects',
        operation: 'listProjects',
        request: 'projects-list',
        response: 'projects-list'
      }]
    }
  };
}

test('dispatches custom manifest routes with a pure request context and normalized project payload', async () => {
  const definition = manifest();
  let received;
  let operationContext;
  const registry = {
    list: () => [definition],
    resolve: key => key === 'demo' ? definition : null,
    getCapability: () => 'fake-projects'
  };
  const runtime = {
    getDriver: (platform, capability, context) => {
      received = { platform, capability, context };
      return {
        listProjects: requestContext => {
          operationContext = requestContext;
          return {
            status: 'ok',
            platform,
            capability,
            operation: 'listProjects',
            data: [{ name: requestContext.params.projectName || 'alpha' }]
          };
        }
      };
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/platforms', createPlatformRouter({ registry, runtime }));

  await expect(request(app, 'GET', '/api/platforms/demo/projects?fresh=1')).resolves.toMatchObject({
    status: 200,
    body: { projects: [{ name: 'alpha' }], currentProject: null, meta: expect.any(Object) }
  });
  expect(received).toMatchObject({
    platform: 'demo',
    capability: 'projects',
    context: { config: undefined, manifest: definition, route: expect.any(Object), apiRoute: true }
  });
  expect(operationContext).toMatchObject({
    platform: 'demo',
    manifest: definition,
    config: undefined,
    params: {},
    query: { fresh: '1' },
    body: {},
    remoteAddress: expect.any(String)
  });
});

test('maps Driver rejection to a failed typed HTTP response', async () => {
  const definition = manifest();
  const registry = {
    list: () => [definition],
    resolve: () => definition,
    getCapability: () => 'fake-projects'
  };
  const app = express();
  app.use('/api/platforms', createPlatformRouter({
    registry,
    runtime: { getDriver: () => ({ listProjects: () => Promise.reject(new Error('boom')) }) }
  }));

  await expect(request(app, 'GET', '/api/platforms/demo/projects')).resolves.toMatchObject({
    status: 500,
    body: { error: expect.objectContaining({ status: 'failed', error: 'boom' }) }
  });
});
