const express = require('express');
const http = require('http');

let piSessionsService;

function buildApp(config = {}) {
  delete require.cache[require.resolve('../../../src/server/api/pi-projects')];
  const createRouter = require('../../../src/server/api/pi-projects');
  const app = express();
  app.use(express.json());
  app.use('/', createRouter(config));
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); },
    delete(url) { return call(app, 'DELETE', url); }
  };
}

function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers: rawBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody)
        } : {}
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on('error', (error) => {
        server.close();
        reject(error);
      });

      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

beforeEach(() => {
  piSessionsService = {
    getProjects: vi.fn(() => [{ name: 'repo-pi' }]),
    saveProjectOrder: vi.fn(),
    deleteProject: vi.fn(() => ({ success: true })),
    isPiInstalled: vi.fn(() => true)
  };

  require.cache[require.resolve('../../../src/server/services/pi-sessions')] = {
    id: require.resolve('../../../src/server/services/pi-sessions'),
    filename: require.resolve('../../../src/server/services/pi-sessions'),
    loaded: true,
    exports: piSessionsService
  };
});

afterEach(() => {
  [
    '../../../src/server/api/pi-projects',
    '../../../src/server/services/pi-sessions'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('pi-projects api', () => {
  test('GET / returns empty payload when Pi is not installed', async () => {
    piSessionsService.isPiInstalled.mockReturnValue(false);
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projects: [],
      currentProject: null,
      error: 'OMP CLI not installed or not found'
    });
  });

  test('GET / returns projects and currentProject', async () => {
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projects: [{ name: 'repo-pi' }],
      currentProject: 'repo-pi'
    });
  });

  test('POST /order validates body and DELETE proxies project removal', async () => {
    const app = buildApp();
    const invalid = await request(app).post('/order', { order: 'bad' });
    const valid = await request(app).post('/order', { order: ['repo-pi'] });
    const deleted = await request(app).delete('/repo-pi');

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(piSessionsService.saveProjectOrder).toHaveBeenCalledWith(['repo-pi']);
    expect(deleted.status).toBe(200);
    expect(piSessionsService.deleteProject).toHaveBeenCalledWith('repo-pi');
  });

  test('DELETE returns 404 for not found errors', async () => {
    piSessionsService.deleteProject.mockImplementationOnce(() => {
      throw new Error('Project not found');
    });
    const res = await request(buildApp()).delete('/repo-pi');
    expect(res.status).toBe(404);
  });
});
