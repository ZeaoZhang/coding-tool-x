'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ── helpers ──────────────────────────────────────────────────────────────────

function findHandler(router, method, routePath) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routePath) {
      for (const s of layer.route.stack) {
        if (s.method === method) return s.handle;
      }
    }
  }
  return null;
}

const mockReq = (o = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
  ...o,
});

const mockRes = () => {
  const r = { statusCode: 200, _data: null };
  r.status = vi.fn(c => { r.statusCode = c; return r; });
  r.json  = vi.fn(d => { r._data = d; return r; });
  return r;
};

// ── stub ──────────────────────────────────────────────────────────────────────

let sessionsStub;

function loadRouter(config = {}) {
  const keys = Object.keys(require.cache).filter(k =>
    k.includes('api/projects') ||
    k.includes('services/sessions')
  );
  keys.forEach(k => delete require.cache[k]);

  require.cache[require.resolve('../../../src/server/services/sessions')] = {
    id: require.resolve('../../../src/server/services/sessions'),
    filename: require.resolve('../../../src/server/services/sessions'),
    loaded: true,
    exports: sessionsStub,
  };

  const factory = require('../../../src/server/api/projects');
  return factory(config);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('projects API router', () => {
  const config = { currentProject: 'alpha' };

  beforeEach(() => {
    sessionsStub = {
      getProjectsWithStats: vi.fn(),
      saveProjectOrder:     vi.fn(),
      getProjectOrder:      vi.fn().mockReturnValue([]),
      deleteProject:        vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── GET / ─────────────────────────────────────────────────────────────────

  it('GET / returns projects sorted by saved order', async () => {
    const projects = [
      { name: 'beta',  lastUsed: 100 },
      { name: 'alpha', lastUsed: 200 },
    ];
    sessionsStub.getProjectsWithStats.mockResolvedValue(projects);
    sessionsStub.getProjectOrder.mockReturnValue(['alpha', 'beta']);

    const router = loadRouter(config);
    const handler = findHandler(router, 'get', '/');
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const data = res._data;
    expect(data.projects[0].name).toBe('alpha');
    expect(data.projects[1].name).toBe('beta');
    expect(data.currentProject).toBe('alpha');
  });

  it('GET / places unordered projects after ordered ones, sorted by lastUsed', async () => {
    const projects = [
      { name: 'gamma', lastUsed: 300 },
      { name: 'delta', lastUsed: 100 },
      { name: 'alpha', lastUsed: 200 },
    ];
    sessionsStub.getProjectsWithStats.mockResolvedValue(projects);
    sessionsStub.getProjectOrder.mockReturnValue(['alpha']);

    const router = loadRouter(config);
    const handler = findHandler(router, 'get', '/');
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const names = res._data.projects.map(p => p.name);
    expect(names[0]).toBe('alpha');
    // gamma has higher lastUsed than delta, so comes before delta
    expect(names[1]).toBe('gamma');
    expect(names[2]).toBe('delta');
  });

  it('GET / uses first project as currentProject when config.currentProject is unset', async () => {
    const projects = [{ name: 'only', lastUsed: 0 }];
    sessionsStub.getProjectsWithStats.mockResolvedValue(projects);
    sessionsStub.getProjectOrder.mockReturnValue([]);

    const router = loadRouter({});
    const handler = findHandler(router, 'get', '/');
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res._data.currentProject).toBe('only');
  });

  it('GET / returns 500 when getProjectsWithStats rejects', async () => {
    sessionsStub.getProjectsWithStats.mockRejectedValue(new Error('db error'));

    const router = loadRouter(config);
    const handler = findHandler(router, 'get', '/');
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'db error' });
  });

  // ── POST /order ───────────────────────────────────────────────────────────

  it('POST /order saves order and returns success', () => {
    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/order');
    const req = mockReq({ body: { order: ['alpha', 'beta', 'gamma'] } });
    const res = mockRes();

    handler(req, res);

    expect(sessionsStub.saveProjectOrder).toHaveBeenCalledWith(config, ['alpha', 'beta', 'gamma']);
    expect(res._data).toMatchObject({ success: true });
  });

  it('POST /order returns 400 when order is not an array', () => {
    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/order');
    const req = mockReq({ body: { order: 'not-an-array' } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/must be an array/i);
    expect(sessionsStub.saveProjectOrder).not.toHaveBeenCalled();
  });

  it('POST /order returns 400 when order is missing', () => {
    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/order');
    const req = mockReq({ body: {} });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /order returns 500 when saveProjectOrder throws', () => {
    sessionsStub.saveProjectOrder.mockImplementation(() => { throw new Error('write fail'); });

    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/order');
    const req = mockReq({ body: { order: ['a'] } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'write fail' });
  });

  // ── POST /create ──────────────────────────────────────────────────────────

  it('POST /create creates .claude/sessions dir and project.json in a real tmpdir', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-test-'));

    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/create');
    const req = mockReq({
      body: { projectName: 'MyProject', projectPath: tmpBase },
    });
    const res = mockRes();

    handler(req, res);

    expect(res._data).toMatchObject({
      success: true,
      projectName: 'MyProject',
      projectPath: tmpBase,
    });

    const claudeDir = path.join(tmpBase, '.claude');
    expect(fs.existsSync(path.join(claudeDir, 'sessions'))).toBe(true);
    expect(fs.existsSync(path.join(claudeDir, 'project.json'))).toBe(true);

    const meta = JSON.parse(fs.readFileSync(path.join(claudeDir, 'project.json'), 'utf8'));
    expect(meta.name).toBe('MyProject');

    // cleanup
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('POST /create returns 400 when projectName is missing', () => {
    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/create');
    const req = mockReq({ body: { projectPath: '/some/path' } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/required/i);
  });

  it('POST /create returns 400 when projectPath is missing', () => {
    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/create');
    const req = mockReq({ body: { projectName: 'X' } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/required/i);
  });

  it('POST /create returns 400 when projectPath does not exist', () => {
    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/create');
    const req = mockReq({
      body: { projectName: 'X', projectPath: '/does/not/exist/ever' },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/不存在/);
  });

  it('POST /create returns 400 when projectPath is already initialised (.claude exists)', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-test-'));
    fs.mkdirSync(path.join(tmpBase, '.claude'));

    const router = loadRouter(config);
    const handler = findHandler(router, 'post', '/create');
    const req = mockReq({
      body: { projectName: 'Dup', projectPath: tmpBase },
    });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._data.error).toMatch(/已经初始化/);

    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  // ── DELETE /:projectName ──────────────────────────────────────────────────

  it('DELETE /:projectName calls deleteProject and returns success', () => {
    const router = loadRouter(config);
    const handler = findHandler(router, 'delete', '/:projectName');
    const req = mockReq({ params: { projectName: 'alpha' } });
    const res = mockRes();

    handler(req, res);

    expect(sessionsStub.deleteProject).toHaveBeenCalledWith(config, 'alpha');
    expect(res._data).toMatchObject({ success: true });
  });

  it('DELETE /:projectName returns 500 when deleteProject throws', () => {
    sessionsStub.deleteProject.mockImplementation(() => { throw new Error('rm failed'); });

    const router = loadRouter(config);
    const handler = findHandler(router, 'delete', '/:projectName');
    const req = mockReq({ params: { projectName: 'alpha' } });
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._data).toMatchObject({ error: 'rm failed' });
  });
});
