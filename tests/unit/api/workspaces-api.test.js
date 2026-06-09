const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

let testDir;
let execFileSyncSpy;
let workspaceService;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspaces-api-'));
  execFileSyncSpy = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => '');

  workspaceService = {
    listWorkspaces: vi.fn(() => [{ id: 'ws-1', name: 'Workspace 1' }]),
    isGitRepo: vi.fn(() => true),
    getGitWorktrees: vi.fn(() => [{ path: '/tmp/worktree', branch: 'feature' }]),
    getAllAvailableProjects: vi.fn(async () => [{ name: 'proj-a', tool: 'claude' }]),
    getWorkspace: vi.fn((id) => (id === 'ws-1' ? { id, name: 'Workspace 1' } : null)),
    createWorkspace: vi.fn((payload) => ({ id: 'ws-1', ...payload })),
    deleteWorkspace: vi.fn(),
    updateWorkspaceLastUsed: vi.fn(),
    addProjectToWorkspace: vi.fn((id, payload) => ({ id, projects: [payload] })),
    removeProjectFromWorkspace: vi.fn((id, projectName) => ({ id, removed: projectName })),
    getLaunchCommand: vi.fn((id, tool, projectName) => ({ id, tool, projectName, command: `${tool} .` }))
  };

  const servicePath = require.resolve('../../../src/server/services/workspace-service');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: workspaceService
  };

  delete require.cache[require.resolve('../../../src/server/api/workspaces')];
});

afterEach(() => {
  execFileSyncSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });
  delete require.cache[require.resolve('../../../src/server/api/workspaces')];
  delete require.cache[require.resolve('../../../src/server/services/workspace-service')];
});

function buildApp() {
  const router = require('../../../src/server/api/workspaces');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); },
    post(url, body) { return call(app, 'POST', url, body); },
    put(url, body) { return call(app, 'PUT', url, body); },
    delete(url) { return call(app, 'DELETE', url); }
  };
}

function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const rawBody = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers: {
          ...(rawBody ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(rawBody)
          } : {})
        }
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

describe('workspace listing and file reading', () => {
  test('lists workspaces', async () => {
    const res = await request(buildApp()).get('/');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  test('reads allowed config files only', async () => {
    const allowedFile = path.join(testDir, 'AGENTS.md');
    fs.writeFileSync(allowedFile, '# workspace rules', 'utf8');

    const res = await request(buildApp()).get(`/read-file?path=${encodeURIComponent(allowedFile)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.content).toBe('# workspace rules');
  });

  test('rejects disallowed file names', async () => {
    const disallowedFile = path.join(testDir, 'README.md');
    fs.writeFileSync(disallowedFile, '# nope', 'utf8');

    const res = await request(buildApp()).get(`/read-file?path=${encodeURIComponent(disallowedFile)}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('returns git info for project path', async () => {
    const res = await request(buildApp()).get(`/check-git/${encodeURIComponent('/tmp/project')}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isGitRepo).toBe(true);
    expect(workspaceService.getGitWorktrees).toHaveBeenCalled();
  });
});

describe('workspace creation and mutation', () => {
  test('validates missing workspace name', async () => {
    const res = await request(buildApp()).post('/', {
      projects: [{ sourcePath: '/tmp/project' }]
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects invalid worktree branch names on create', async () => {
    execFileSyncSpy.mockImplementation(() => { throw new Error('bad branch'); });
    const res = await request(buildApp()).post('/', {
      name: 'Workspace',
      projects: [{ sourcePath: '/tmp/project', createWorktree: true, branch: 'bad branch' }]
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('creates workspace with normalized branch values', async () => {
    const res = await request(buildApp()).post('/', {
      name: 'Workspace',
      description: 'Test',
      baseDir: '/tmp',
      projects: [{
        sourcePath: '/tmp/project',
        createWorktree: true,
        branchMode: 'new',
        branch: ' feature/test ',
        baseBranch: ' main '
      }]
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(workspaceService.createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Workspace',
      projects: [expect.objectContaining({
        branchMode: 'new',
        branch: 'feature/test',
        baseBranch: 'main'
      })]
    }));
  });

  test('rejects invalid branch mode on create', async () => {
    const res = await request(buildApp()).post('/', {
      name: 'Workspace',
      projects: [{
        sourcePath: '/tmp/project',
        createWorktree: true,
        branchMode: 'surprise',
        branch: 'feature/test'
      }]
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('分支模式不合法');
  });

  test('allows worktree creation without branch and defers to workspace service fallback', async () => {
    const res = await request(buildApp()).post('/', {
      name: 'Workspace',
      projects: [{
        sourcePath: '/tmp/project',
        createWorktree: true,
        branch: '   '
      }]
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(workspaceService.createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      projects: [expect.objectContaining({
        createWorktree: true,
        branch: '   '
      })]
    }));
  });

  test('passes removeFiles flag when deleting workspace', async () => {
    const res = await request(buildApp()).delete('/ws-1?removeFiles=true');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith('ws-1', true);
  });

  test('updates workspace last used timestamp', async () => {
    const res = await request(buildApp()).put('/ws-1/last-used', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(workspaceService.updateWorkspaceLastUsed).toHaveBeenCalledWith('ws-1');
  });
});

describe('workspace project and launch routes', () => {
  test('validates sourcePath when adding project', async () => {
    const res = await request(buildApp()).post('/ws-1/projects', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('validates branch name when adding worktree project', async () => {
    execFileSyncSpy.mockImplementation(() => { throw new Error('bad branch'); });
    const res = await request(buildApp()).post('/ws-1/projects', {
      sourcePath: '/tmp/project',
      createWorktree: true,
      branch: 'bad branch'
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('adds project with normalized branches', async () => {
    const res = await request(buildApp()).post('/ws-1/projects', {
      sourcePath: '/tmp/project',
      name: 'project-a',
      createWorktree: true,
      branchMode: 'new',
      branch: ' feature/a ',
      baseBranch: ' main '
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(workspaceService.addProjectToWorkspace).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      sourcePath: '/tmp/project',
      branchMode: 'new',
      branch: 'feature/a',
      baseBranch: 'main'
    }));
  });

  test('rejects invalid branch mode when adding project', async () => {
    const res = await request(buildApp()).post('/ws-1/projects', {
      sourcePath: '/tmp/project',
      createWorktree: true,
      branchMode: 'surprise',
      branch: 'feature/a'
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('分支模式不合法');
  });

  test('allows adding worktree project without branch and keeps blank branch value', async () => {
    const res = await request(buildApp()).post('/ws-1/projects', {
      sourcePath: '/tmp/project',
      createWorktree: true,
      branch: '   '
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(workspaceService.addProjectToWorkspace).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      sourcePath: '/tmp/project',
      createWorktree: true,
      branch: '   '
    }));
  });

  test('removes project from workspace', async () => {
    const res = await request(buildApp()).delete('/ws-1/projects/project-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(workspaceService.removeProjectFromWorkspace).toHaveBeenCalledWith('ws-1', 'project-a');
  });

  test('requires tool when building launch command', async () => {
    const res = await request(buildApp()).post('/ws-1/launch', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns launch command payload', async () => {
    const res = await request(buildApp()).post('/ws-1/launch', {
      tool: 'codex',
      projectName: 'project-a'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(workspaceService.getLaunchCommand).toHaveBeenCalledWith('ws-1', 'codex', 'project-a');
  });
});
