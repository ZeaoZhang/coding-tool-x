'use strict';

const express = require('express');
const http = require('http');

const servicePath = require.resolve('../../../src/server/services/project-config-service');
let projectConfigService;

beforeEach(() => {
  projectConfigService = {
    getSnapshot: vi.fn(async (projectPath, platform) => ({
      success: true,
      projectPath,
      platform,
      instruction: { supported: true, path: 'AGENTS.md', exists: false, content: '', updatedAt: null },
      skills: { supported: true, project: [], inherited: [] },
      mcp: { supported: true, path: '.codex/config.toml', servers: [] },
      capabilities: { instruction: true, skills: true, mcp: true }
    })),
    listProjectSkills: vi.fn(async () => ({ supported: true, project: [], inherited: [] })),
    setProjectSkillEnabled: vi.fn(async (_path, _platform, controlKey, enabled) => ({
      controlKey,
      enabled,
      status: 'disabled'
    })),
    readInstruction: vi.fn(async () => ({ supported: true, path: 'AGENTS.md', exists: false, content: '', updatedAt: null })),
    writeInstruction: vi.fn(async (_path, _platform, content) => ({ supported: true, path: 'AGENTS.md', content })),
    deleteInstruction: vi.fn(async () => ({ supported: true, path: 'AGENTS.md', deleted: true })),
    listProjectMcp: vi.fn(async () => ({ supported: true, path: '.mcp.json', servers: [] })),
    upsertProjectMcp: vi.fn(async (_path, _platform, id, server) => ({ success: true, id, server, scope: 'project' })),
    removeProjectMcp: vi.fn(async (_path, _platform, id) => ({ success: true, id, removed: true, scope: 'project' })),
    testProjectMcp: vi.fn(async (_path, _platform, id) => ({ success: true, id, scope: 'project' }))
  };
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      ProjectConfigService: function ProjectConfigServiceStub() {
        return projectConfigService;
      }
    }
  };
  delete require.cache[require.resolve('../../../src/server/api/project-config')];
});

afterEach(() => {
  delete require.cache[require.resolve('../../../src/server/api/project-config')];
  delete require.cache[servicePath];
});

function buildApp() {
  const router = require('../../../src/server/api/project-config');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    put(url, body) { return call(app, 'PUT', url, body); },
    delete(url, body) { return call(app, 'DELETE', url, body); },
    post(url, body) { return call(app, 'POST', url, body); }
  };
}

function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const rawBody = body === undefined ? null : JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers: rawBody
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rawBody) }
          : {}
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', error => {
        server.close();
        reject(error);
      });
      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

test('returns the project configuration snapshot', async () => {
  const res = await request(buildApp()).get('/?projectPath=%2Ftmp%2Fproject&platform=codex');

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.projectPath).toBe('/tmp/project');
  expect(res.body.platform).toBe('codex');
  expect(projectConfigService.getSnapshot).toHaveBeenCalledWith('/tmp/project', 'codex');
});

test('rejects project MCP mutation without projectPath', async () => {
  const res = await request(buildApp()).put('/mcp/demo', {
    platform: 'claude',
    server: { type: 'stdio', command: 'node' }
  });

  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
  expect(projectConfigService.upsertProjectMcp).not.toHaveBeenCalled();
});

test('returns structured unsupported instruction state', async () => {
  projectConfigService.readInstruction.mockResolvedValue({ supported: false, path: null, exists: false, content: '' });
  const res = await request(buildApp()).get('/instruction?projectPath=%2Ftmp%2Fproject&platform=omp');

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.instruction.supported).toBe(false);
});

test('passes project path and platform to MCP mutations', async () => {
  const res = await request(buildApp()).put('/mcp/local', {
    projectPath: '/tmp/project',
    platform: 'claude',
    server: { type: 'stdio', command: 'node' }
  });

  expect(res.status).toBe(200);

  expect(projectConfigService.upsertProjectMcp).toHaveBeenCalledWith(
    '/tmp/project',
    'claude',
    'local',
    { type: 'stdio', command: 'node' }
  );
});
test('lists project Skills through the project scan facade', async () => {
  projectConfigService.listProjectSkills.mockResolvedValue({
    supported: true,
    project: [{ controlKey: 'project-skill', enabled: true, managed: true }],
    inherited: []
  });

  const res = await request(buildApp()).get('/skills?projectPath=%2Ftmp%2Fproject&platform=codex');

  expect(res.status).toBe(200);
  expect(res.body.skills.project[0].controlKey).toBe('project-skill');
  expect(projectConfigService.listProjectSkills).toHaveBeenCalledWith('/tmp/project', 'codex');
});

test('toggles a project Skill through the effective control service', async () => {
  const res = await request(buildApp()).put('/skills/toggle', {
    projectPath: '/tmp/project',
    platform: 'codex',
    controlKey: 'project-skill',
    enabled: false
  });

  expect(res.status).toBe(200);
  expect(projectConfigService.setProjectSkillEnabled).toHaveBeenCalledWith(
    '/tmp/project',
    'codex',
    'project-skill',
    false
  );
});
