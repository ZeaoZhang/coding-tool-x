/**
 * Tests for src/server/api/skills.js
 * Covers: GET /, GET /installed, POST /install, POST /uninstall,
 *         GET /repos, POST /repos, DELETE /repos
 */

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mockService;
let services;
let readOmpSkillSettings;
let updateOmpSkillSettings;

beforeEach(() => {
  mockService = createMockService();
  services = {
    claude: mockService,
    codex: createMockService(),
    gemini: createMockService(),
    opencode: createMockService(),
    omp: createMockService()
  };

  // Stub skill-service module before requiring the router
  // Must use a real constructor function (not arrow) so `new SkillService()` works
  const SkillServiceStub = function(platform = 'claude') {
    return services[platform] || services.claude;
  };
  const skillServicePath = require.resolve('../../../src/server/services/skill-service');
  require.cache[skillServicePath] = {
    id: skillServicePath,
    filename: skillServicePath,
    loaded: true,
    exports: {
      SkillService: SkillServiceStub
    }
  };

  readOmpSkillSettings = vi.fn(() => ({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: true
  }));
  updateOmpSkillSettings = vi.fn(patch => ({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: true,
    ...patch
  }));
  const ompSkillSettingsServicePath = require.resolve('../../../src/server/services/omp-skill-settings-service');
  require.cache[ompSkillSettingsServicePath] = {
    id: ompSkillSettingsServicePath,
    filename: ompSkillSettingsServicePath,
    loaded: true,
    exports: {
      readOmpSkillSettings,
      updateOmpSkillSettings
    }
  };
  const validationPath = require.resolve('../../../src/server/services/project-path-validation');
  require.cache[validationPath] = {
    id: validationPath,
    filename: validationPath,
    loaded: true,
    exports: {
      validateKnownProjectCwd: vi.fn(async rawCwd => {
        if (rawCwd == null || String(rawCwd).trim() === '') return null;
        const candidate = fs.realpathSync(String(rawCwd).trim());
        if (candidate !== fs.realpathSync(process.cwd())) {
          throw new Error('Invalid cwd: path is not a known project or workspace');
        }
        return candidate;
      })
    }
  };

  delete require.cache[require.resolve('../../../src/server/api/skills')];
});

function createMockService() {
  return {
    listSkills: vi.fn(async () => [{ name: 'test-skill', installed: false }]),
    scanSkills: vi.fn(async () => ({
      skills: [{ name: 'test-skill', enabled: false, cached: true, managed: true }],
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    })),
    getInstalledSkills: vi.fn(() => []),
    getSkillDetail: vi.fn(async () => ({ name: 'test', content: '# Test' })),
    installSkill: vi.fn(async () => ({ success: true })),
    uninstallSkill: vi.fn(() => ({ success: true })),
    loadRepos: vi.fn(() => [{ owner: 'anthropics', name: 'skills', token: 'secret-token' }]),
    addRepo: vi.fn(() => [{ owner: 'anthropics', name: 'skills', token: 'secret-token' }]),
    removeRepo: vi.fn(() => []),
    toggleRepo: vi.fn(() => []),
    updateRepoAuth: vi.fn(() => [{ owner: 'anthropics', name: 'skills', token: 'updated-secret' }]),
    createSkill: vi.fn(() => ({ success: true })),
    createSkillWithFiles: vi.fn(() => ({ success: true })),
    getSkillFiles: vi.fn(() => []),
    getSkillFile: vi.fn(() => ({ content: '# Test' })),
    getSkillFileContent: vi.fn(() => ({ content: '# Test' })),
    saveSkillFile: vi.fn(() => ({ success: true })),
    addSkillFiles: vi.fn(() => ({ success: true })),
    updateSkillFile: vi.fn(() => ({ success: true })),
    deleteSkillFile: vi.fn(() => ({ success: true })),
    installLocalSkill: vi.fn(() => ({ success: true })),
    createCustomSkill: vi.fn(() => ({ success: true }))
  };
}

afterEach(() => {
  delete require.cache[require.resolve('../../../src/server/api/skills')];
  delete require.cache[require.resolve('../../../src/server/services/skill-service')];
  delete require.cache[require.resolve('../../../src/server/services/omp-skill-settings-service')];
  delete require.cache[require.resolve('../../../src/server/services/project-path-validation')];
});

function buildApp() {
  const router = require('../../../src/server/api/skills');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: supertest-lite using node http
// ---------------------------------------------------------------------------
const http = require('http');

function request(app) {
  return {
    get(url) { return call(app, 'GET', url, null); },
    post(url, body) { return call(app, 'POST', url, body); },
    put(url, body) { return call(app, 'PUT', url, body); },
    delete(url) { return call(app, 'DELETE', url, null); }
  };
}

function call(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const bodyStr = body ? JSON.stringify(body) : null;
      const options = {
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
        }
      };
      const req = http.request(options, (res) => {
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
      req.on('error', (err) => { server.close(); reject(err); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------
describe('GET /', () => {
  test('returns local Skill state with total and enabled count omitted from unique lifecycle', async () => {
    mockService.scanSkills.mockResolvedValue({
      skills: [
        { name: 'a', enabled: true, cached: true, managed: true },
        { name: 'b', enabled: false, cached: true, managed: true }
      ],
      refresh: { state: 'idle', taskId: null, fetchedAt: Date.now(), error: null }
    });
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body).not.toHaveProperty('installed');
    expect(res.body.skills[0]).toEqual(expect.objectContaining({ cached: true, managed: true }));
  });

  test('returns 500 on scan service error', async () => {
    mockService.scanSkills.mockRejectedValue(new Error('db error'));
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });


  test('routes OMP scan to the OMP service instance', async () => {
    services.omp.scanSkills.mockResolvedValue({
      skills: [{ name: 'omp-skill', enabled: true, cached: true, managed: true }],
      refresh: { state: 'idle', taskId: null, fetchedAt: null, error: null }
    });
    const app = buildApp();
    const res = await request(app).get('/?platform=omp');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('omp');
    expect(services.omp.scanSkills).toHaveBeenCalled();
    expect(services.claude.scanSkills).not.toHaveBeenCalled();
  });

  test('normalizes platform case and whitespace', async () => {
    const app = buildApp();
    const res = await request(app).get('/?platform=%20OMP%20');

    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('omp');
    expect(services.omp.scanSkills).toHaveBeenCalled();
    expect(services.claude.scanSkills).not.toHaveBeenCalled();
  });

  test('maps deprecated pi to omp and returns a warning', async () => {
    const app = buildApp();
    const res = await request(app).get('/?platform=pi');

    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('omp');
    expect(res.body.warnings).toEqual([expect.stringMatching(/deprecated/i)]);
    expect(services.omp.scanSkills).toHaveBeenCalled();
  });

  test.each(['omx', 'unknown'])('rejects unsupported platform %s', async platform => {
    const app = buildApp();
    const res = await request(app).get(`/?platform=${platform}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(services.claude.scanSkills).not.toHaveBeenCalled();
  });

  test('passes a validated project cwd to OMP scan', async () => {
    const app = buildApp();
    const cwd = fs.realpathSync(process.cwd());
    const res = await request(app).get(`/?platform=omp&cwd=${encodeURIComponent(cwd)}`);

    expect(res.status).toBe(200);
    expect(services.omp.scanSkills).toHaveBeenCalledWith({ cwd, scope: 'user' });
  });

  test('rejects an existing cwd that is not a known project or workspace', async () => {
    const unknownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-skill-cwd-'));
    try {
      const app = buildApp();
      const res = await request(app).get(`/?platform=omp&cwd=${encodeURIComponent(unknownDir)}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/known project or workspace/i);
      expect(services.omp.scanSkills).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(unknownDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// OMP skill settings
// ---------------------------------------------------------------------------
describe('OMP skill settings', () => {
  test('GET /omp-settings returns all OMP settings', async () => {
    const settings = {
      enableCodexUser: false,
      enableClaudeUser: true,
      enablePiUser: false,
      enablePiProject: true
    };
    readOmpSkillSettings.mockReturnValue(settings);
    const app = buildApp();

    const res = await request(app).get('/omp-settings');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, settings });
    expect(readOmpSkillSettings).toHaveBeenCalledOnce();
  });

  test('PUT /omp-settings passes a partial update to the OMP settings service', async () => {
    const patch = { enablePiProject: false };
    const settings = {
      enableCodexUser: true,
      enableClaudeUser: true,
      enablePiUser: true,
      enablePiProject: false
    };
    updateOmpSkillSettings.mockReturnValue(settings);
    const app = buildApp();

    const res = await request(app).put('/omp-settings', patch);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, settings });
    expect(updateOmpSkillSettings).toHaveBeenCalledWith(patch);
  });

  test('PUT /omp-settings maps unknown fields rejected by the service to 400', async () => {
    updateOmpSkillSettings.mockImplementation(() => {
      throw new Error('Invalid OMP skill setting: unknownSetting');
    });
    const app = buildApp();

    const res = await request(app).put('/omp-settings', { unknownSetting: true });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Invalid OMP skill setting: unknownSetting'
    });
  });

  test('GET /omp-settings preserves the API error format on service failure', async () => {
    readOmpSkillSettings.mockImplementation(() => {
      throw new Error('read failed');
    });
    const app = buildApp();

    const res = await request(app).get('/omp-settings');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'read failed' });
  });

  test('PUT /omp-settings preserves the API error format on service failure', async () => {
    updateOmpSkillSettings.mockImplementation(() => {
      throw new Error('write failed');
    });
    const app = buildApp();

    const res = await request(app).put('/omp-settings', { enablePiUser: false });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'write failed' });
  });
});

// ---------------------------------------------------------------------------
// GET /installed is retained as a scan-only compatibility route.
// ---------------------------------------------------------------------------
describe('GET /installed', () => {
  test('returns installed skills', async () => {
    mockService.scanSkills.mockResolvedValue({
      skills: [{ name: 'my-skill', enabled: true, cached: true, managed: true }],
      refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
    });
    const app = buildApp();
    const res = await request(app).get('/installed');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.skills).toHaveLength(1);
  });

  test('returns 500 on service error', async () => {
    mockService.scanSkills.mockRejectedValue(new Error('fail'));
    const app = buildApp();
    const res = await request(app).get('/installed');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legacy lifecycle routes
// ---------------------------------------------------------------------------
describe('legacy Skill lifecycle routes', () => {
  test.each(['/install', '/install-local', '/uninstall'])('%s returns 410 without mutating files', async route => {
    const app = buildApp();
    const res = await request(app).post(route, {
      platform: 'claude',
      directory: 'demo',
      repo: { owner: 'owner', name: 'repo' }
    });

    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(mockService.installSkill).not.toHaveBeenCalled();
    expect(mockService.installLocalSkill).not.toHaveBeenCalled();
    expect(mockService.uninstallSkill).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /repos
// ---------------------------------------------------------------------------
describe('GET /repos', () => {
  test('returns repos list', async () => {
    const app = buildApp();
    const res = await request(app).get('/repos');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.repos)).toBe(true);
    expect(res.body.repos[0].owner).toBe('anthropics');
    expect(res.body.repos[0].token).toBeUndefined();
    expect(res.body.repos[0].hasToken).toBe(true);
    expect(res.body.repos[0].tokenPreview).toBe('secr...oken');
  });

  test('returns 500 on service error', async () => {
    mockService.loadRepos.mockImplementation(() => { throw new Error('fail'); });
    const app = buildApp();
    const res = await request(app).get('/repos');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /repos
// ---------------------------------------------------------------------------
describe('POST /repos', () => {
  test('adds repo and returns updated list', async () => {
    mockService.addRepo.mockReturnValue([
      { owner: 'anthropics', name: 'skills' },
      { owner: 'myorg', name: 'my-skills' }
    ]);
    const app = buildApp();
    const res = await request(app).post('/repos', {
      owner: 'myorg',
      name: 'my-skills',
      branch: 'main'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.repos).toHaveLength(2);
  });

  test('missing owner and name → 400', async () => {
    const app = buildApp();
    const res = await request(app).post('/repos', { branch: 'main' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DELETE /repos
// ---------------------------------------------------------------------------
describe('DELETE /repos', () => {
  test('removes repo and returns updated list', async () => {
    mockService.removeRepo.mockReturnValue([]);
    const app = buildApp();
    const res = await request(app).delete('/repos?owner=anthropics&name=skills');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.repos).toEqual([]);
  });

  test('returns 500 on service error', async () => {
    mockService.removeRepo.mockImplementation(() => { throw new Error('fail'); });
    const app = buildApp();
    const res = await request(app).delete('/repos?owner=anthropics&name=skills');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /detail/*
// ---------------------------------------------------------------------------
describe('GET /detail/*', () => {
  test('passes repo hint and fullDirectory to service', async () => {
    mockService.getSkillDetail.mockResolvedValue({ name: 'test-skill', fullContent: '# Test' });
    const app = buildApp();
    const res = await request(app).get('/detail/my-skill?platform=codex&owner=openai&name=skills&branch=main&directory=skills/.curated&fullDirectory=skills/.curated/my-skill');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('codex');
    expect(services.codex.getSkillDetail).toHaveBeenCalledWith(
      'my-skill',
      expect.objectContaining({
        owner: 'openai',
        name: 'skills',
        branch: 'main',
        directory: 'skills/.curated'
      }),
      'skills/.curated/my-skill'
    );
  });
});

// ---------------------------------------------------------------------------
// POST /install-local (legacy lifecycle)
// ---------------------------------------------------------------------------
describe('POST /install-local', () => {
  test('returns 410 without mutating local Skill state', async () => {
    const app = buildApp();
    const res = await request(app).post('/install-local', { directory: 'local-skill', platform: 'opencode' });

    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(services.opencode.installLocalSkill).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /create
// ---------------------------------------------------------------------------
describe('POST /create', () => {
  test('creates custom skill and defaults name to directory', async () => {
    const app = buildApp();
    const res = await request(app).post('/create', {
      directory: 'custom_skill',
      description: 'desc',
      content: '# Skill content'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.createCustomSkill).toHaveBeenCalledWith({
      name: 'custom_skill',
      directory: 'custom_skill',
      description: 'desc',
      content: '# Skill content'
    });
  });

  test('rejects invalid directory name', async () => {
    const app = buildApp();
    const res = await request(app).post('/create', {
      directory: 'bad/name',
      content: '# Skill content'
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PUT /repos/toggle
// ---------------------------------------------------------------------------
describe('PUT /repos/toggle', () => {
  test('toggles repo using body payload', async () => {
    mockService.toggleRepo.mockReturnValue([{ owner: 'anthropics', name: 'skills', enabled: false }]);
    const app = buildApp();
    const res = await request(app).put('/repos/toggle', {
      id: 'repo-1',
      owner: 'anthropics',
      name: 'skills',
      directory: 'nested/skills',
      enabled: false
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.toggleRepo).toHaveBeenCalledWith('anthropics', 'skills', 'nested/skills', false, 'repo-1');
  });
});

// ---------------------------------------------------------------------------
// PUT /repos/auth
// ---------------------------------------------------------------------------
describe('PUT /repos/auth', () => {
  test('updates repo auth and returns sanitized repos', async () => {
    const app = buildApp();
    const res = await request(app).put('/repos/auth', {
      id: 'repo-1',
      owner: 'anthropics',
      name: 'skills',
      directory: 'nested/skills',
      token: 'new-secret-token'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.updateRepoAuth).toHaveBeenCalledWith(
      'anthropics',
      'skills',
      'nested/skills',
      'new-secret-token',
      false,
      'repo-1'
    );
    expect(res.body.repos[0].token).toBeUndefined();
    expect(res.body.repos[0].hasToken).toBe(true);
  });

  test('validates missing token when not clearing auth', async () => {
    const app = buildApp();
    const res = await request(app).put('/repos/auth', {
      id: 'repo-1',
      owner: 'anthropics',
      name: 'skills',
      token: '   '
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /create-with-files
// ---------------------------------------------------------------------------
describe('POST /create-with-files', () => {
  test('creates multi-file skill', async () => {
    mockService.createSkillWithFiles.mockReturnValue({ success: true, directory: 'bundle' });
    const app = buildApp();
    const res = await request(app).post('/create-with-files', {
      directory: 'bundle',
      files: [{ path: 'SKILL.md', content: '# Test' }]
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.createSkillWithFiles).toHaveBeenCalledWith({
      directory: 'bundle',
      files: [{ path: 'SKILL.md', content: '# Test' }]
    });
  });

  test('returns 400 when files are missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/create-with-files', { directory: 'bundle' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Skills file routes
// ---------------------------------------------------------------------------
describe('skills file routes', () => {
  test('GET /:directory/files returns file list', async () => {
    mockService.getSkillFiles.mockReturnValue([{ path: 'SKILL.md', size: 10, isDirectory: false }]);
    const app = buildApp();
    const res = await request(app).get('/my-skill/files?platform=gemini');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('gemini');
    expect(services.gemini.getSkillFiles).toHaveBeenCalledWith('my-skill');
  });

  test('GET /:directory/file/* returns file content', async () => {
    mockService.getSkillFileContent.mockReturnValue({ path: 'docs/guide.md', content: '# Guide' });
    const app = buildApp();
    const res = await request(app).get('/my-skill/file/docs/guide.md');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.getSkillFileContent).toHaveBeenCalledWith('my-skill', 'docs/guide.md');
  });

  test('POST /:directory/files adds files', async () => {
    mockService.addSkillFiles.mockReturnValue({ success: true, added: ['docs/guide.md'] });
    const app = buildApp();
    const res = await request(app).post('/my-skill/files', {
      files: [{ path: 'docs/guide.md', content: '# Guide' }]
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.addSkillFiles).toHaveBeenCalledWith('my-skill', [{ path: 'docs/guide.md', content: '# Guide' }]);
  });

  test('POST /:directory/files validates files array', async () => {
    const app = buildApp();
    const res = await request(app).post('/my-skill/files', { files: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('DELETE /:directory/file/* removes file', async () => {
    mockService.deleteSkillFile.mockReturnValue({ success: true, deleted: 'docs/guide.md' });
    const app = buildApp();
    const res = await request(app).delete('/my-skill/file/docs/guide.md');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.deleteSkillFile).toHaveBeenCalledWith('my-skill', 'docs/guide.md');
  });

  test('PUT /:directory/file/* updates file content', async () => {
    mockService.updateSkillFile.mockReturnValue({ success: true, updated: 'docs/guide.md' });
    const app = buildApp();
    const res = await request(app).put('/my-skill/file/docs/guide.md', {
      content: '# Updated',
      isBase64: false
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockService.updateSkillFile).toHaveBeenCalledWith('my-skill', 'docs/guide.md', '# Updated', false);
  });

  test('PUT /:directory/file/* validates missing content', async () => {
    const app = buildApp();
    const res = await request(app).put('/my-skill/file/docs/guide.md', {});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('new Skill control surface', () => {
  function buildInjectedApp({ controlService, refreshTasks } = {}) {
    const routerModule = require('../../../src/server/api/skills');
    const router = routerModule.createRouter({
      skillServiceFactory: platform => services[platform],
      controlService,
      refreshTasks
    });
    const app = express();
    app.use(express.json());
    app.use('/', router);
    return app;
  }

  test('GET never performs remote refresh even when refresh query is present', async () => {
    mockService.scanSkills = vi.fn(async () => ({
      skills: [{ name: 'local', enabled: true, cached: true, managed: true }],
      refresh: { state: 'never_fetched', fetchedAt: null, error: null }
    }));
    mockService.refreshRemoteSkills = vi.fn();

    const app = buildInjectedApp({
      controlService: { setSkillEnabled: vi.fn() },
      refreshTasks: { enqueue: vi.fn(), get: vi.fn() }
    });
    const res = await request(app).get('/?platform=claude&refresh=1');

    expect(res.status).toBe(200);
    expect(mockService.scanSkills).toHaveBeenCalledWith({ scope: 'user' });
    expect(mockService.refreshRemoteSkills).not.toHaveBeenCalled();
    expect(res.body).not.toHaveProperty('installed');
  });

  test('POST refresh returns an asynchronous task snapshot', async () => {
    const task = { id: 'task-1', status: 'queued', platform: 'claude', scope: 'user' };
    const enqueue = vi.fn(() => task);
    const app = buildInjectedApp({
      controlService: { setSkillEnabled: vi.fn() },
      refreshTasks: { enqueue, get: vi.fn() }
    });

    const res = await request(app).post('/refresh', { platform: 'claude' });

    expect(res.status).toBe(202);
    expect(res.body.task).toEqual(task);
    expect(enqueue).toHaveBeenCalledWith({ platform: 'claude', scope: 'user', projectPath: null, reason: 'manual' });
  });

  test('scopes refresh task reads to the requested platform and scope', async () => {
    const task = { id: 'task-1', status: 'succeeded', platform: 'claude', scope: 'user', projectPath: null };
    const get = vi.fn(() => task);
    const app = buildInjectedApp({
      controlService: { setSkillEnabled: vi.fn() },
      refreshTasks: { enqueue: vi.fn(), get }
    });

    const allowed = await request(app).get('/refresh/task-1?platform=claude&scope=user');
    const mismatched = await request(app).get('/refresh/task-1?platform=codex&scope=user');

    expect(allowed.status).toBe(200);
    expect(mismatched.status).toBe(404);
    expect(get).toHaveBeenCalledTimes(2);
  });

  test('PUT toggle delegates activation to the effective control service', async () => {
    const setSkillEnabled = vi.fn(() => ({ enabled: false, artifact: { state: 'ready' } }));
    const app = buildInjectedApp({
      controlService: { setSkillEnabled },
      refreshTasks: { enqueue: vi.fn(), get: vi.fn() }
    });

    const res = await request(app).put('/toggle', {
      platform: 'claude',
      scope: 'user',
      controlKey: 'skill:claude:user:user:local',
      enabled: false
    });

    expect(res.status).toBe(200);
    expect(setSkillEnabled).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'claude',
      scope: 'user',
      projectPath: null,
      controlKey: 'skill:claude:user:user:local',
      enabled: false
    }));
    expect(res.body.artifact.state).toBe('ready');
  });

  test('PUT trust updates approval without enabling the Skill', async () => {
    const setSkillTrust = vi.fn(() => ({ trust: 'approved', enabled: false }));
    const app = buildInjectedApp({
      controlService: { setSkillEnabled: vi.fn(), setSkillTrust },
      refreshTasks: { enqueue: vi.fn(), get: vi.fn() }
    });

    const res = await request(app).put('/trust', {
      platform: 'claude',
      scope: 'user',
      controlKey: 'skill:claude:user:user:local',
      trust: 'approved'
    });

    expect(res.status).toBe(200);
    expect(setSkillTrust).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'claude',
      scope: 'user',
      projectPath: null,
      controlKey: 'skill:claude:user:user:local',
      trust: 'approved'
    }));
    expect(res.body.enabled).toBe(false);
  });
});
