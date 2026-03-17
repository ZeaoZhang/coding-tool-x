/**
 * Tests for src/server/api/health-check.js
 *
 * Pattern: inject vi.fn() stubs into require.cache before requiring the module
 * under test. Mirrors the channel-scheduler.test.js pattern used in this project.
 */

const HC_PATH      = require.resolve('../../../src/server/services/health-check');
const SESSIONS_PATH = require.resolve('../../../src/server/services/sessions');
const API_PATH     = require.resolve('../../../src/server/api/health-check');

let healthCheckAllProjects;
let getProjects;
let makeRouter;

function injectStubs() {
  healthCheckAllProjects = vi.fn(() => ({ healthy: 2, unhealthy: 0, projects: [] }));
  getProjects = vi.fn(async () => [{ name: 'test-project' }]);

  require.cache[HC_PATH] = {
    id: HC_PATH, filename: HC_PATH, loaded: true,
    exports: { healthCheckAllProjects }
  };
  require.cache[SESSIONS_PATH] = {
    id: SESSIONS_PATH, filename: SESSIONS_PATH, loaded: true,
    exports: { getProjects }
  };
}

function findHandler(router, method, routePath) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) {
      for (const routeLayer of layer.route.stack) {
        if (routeLayer.method === method) {
          return routeLayer.handle;
        }
      }
    }
  }
  return null;
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

const config = { projectsDir: '/tmp/test-projects' };
let router;

beforeEach(() => {
  delete require.cache[API_PATH];
  injectStubs();
  makeRouter = require('../../../src/server/api/health-check');
  router = makeRouter(config);
});

afterEach(() => {
  delete require.cache[API_PATH];
});

describe('GET /api/health-check', () => {
  it('returns success:true with timestamp and health result', async () => {
    healthCheckAllProjects.mockReturnValue({ healthy: 2, unhealthy: 0, projects: [] });
    getProjects.mockResolvedValue([{ name: 'proj-a' }, { name: 'proj-b' }]);

    const handler = findHandler(router, 'get', '/');
    expect(handler).toBeTruthy();

    const req = {};
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(typeof res._body.timestamp).toBe('string');
    expect(res._body.healthy).toBe(2);
    expect(res._body.unhealthy).toBe(0);
  });

  it('returns success:true with empty projects array', async () => {
    healthCheckAllProjects.mockReturnValue({ healthy: 0, unhealthy: 0, projects: [] });
    getProjects.mockResolvedValue([]);

    const handler = findHandler(router, 'get', '/');
    const res = makeRes();
    await handler({}, res);

    expect(res._body.success).toBe(true);
    expect(res._body.healthy).toBe(0);
  });

  it('returns 500 when getProjects throws', async () => {
    getProjects.mockRejectedValue(new Error('disk error'));

    const handler = findHandler(router, 'get', '/');
    const res = makeRes();
    await handler({}, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('disk error');
  });

  it('returns 500 when healthCheckAllProjects throws', async () => {
    getProjects.mockResolvedValue([{ name: 'proj-a' }]);
    healthCheckAllProjects.mockImplementation(() => { throw new Error('check failed'); });

    const handler = findHandler(router, 'get', '/');
    const res = makeRes();
    await handler({}, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('check failed');
  });

  it('passes config to getProjects', async () => {
    getProjects.mockResolvedValue([]);
    healthCheckAllProjects.mockReturnValue({ healthy: 0, unhealthy: 0, projects: [] });

    const handler = findHandler(router, 'get', '/');
    await handler({}, makeRes());

    expect(getProjects).toHaveBeenCalledWith(config);
  });

  it('timestamp is a valid ISO string', async () => {
    getProjects.mockResolvedValue([]);
    healthCheckAllProjects.mockReturnValue({ healthy: 0, unhealthy: 0, projects: [] });

    const handler = findHandler(router, 'get', '/');
    const res = makeRes();
    await handler({}, res);

    const ts = res._body.timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});
