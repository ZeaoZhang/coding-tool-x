const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let testDir;
let paths;
let getOmpStatusMock;
let readJsonFileMock;
let readYamlFileMock;
let getOmpAuthProviderSnapshotMock;

function buildApp() {
  delete require.cache[require.resolve('../../../src/platforms/drivers/omp/api-config')];
  const router = require('../../../src/platforms/drivers/omp/api-config');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function request(app) {
  return {
    get(url) { return call(app, 'GET', url); }
  };
}

function call(app, method, url) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method
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

      req.end();
    });
  });
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-config-api-'));
  paths = {
    agentDir: path.join(testDir, 'agent'),
    config: path.join(testDir, 'agent', 'config.yml'),
    settings: path.join(testDir, 'agent', 'config.yml'),
    auth: path.join(testDir, 'agent', 'auth.json'),
    models: path.join(testDir, 'agent', 'models.yml'),
    modelsYml: path.join(testDir, 'agent', 'models.yml'),
    modelsJsonLegacy: path.join(testDir, 'agent', 'models.json'),
    sessions: path.join(testDir, 'agent', 'sessions'),
    skills: path.join(testDir, 'agent', 'skills'),
    prompts: path.join(testDir, 'agent', 'prompts'),
    commands: path.join(testDir, 'agent', 'commands'),
    notes: path.join(testDir, 'agent', 'notes'),
    extensions: path.join(testDir, 'agent', 'extensions')
  };
  for (const dir of [paths.skills, paths.prompts, paths.commands, paths.notes, paths.extensions, paths.sessions]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(paths.skills, 'review-skill'), { recursive: true });
  fs.writeFileSync(path.join(paths.prompts, 'review.md'), 'Review', 'utf8');
  fs.writeFileSync(path.join(paths.prompts, 'ignore.txt'), 'Ignore', 'utf8');
  fs.writeFileSync(path.join(paths.commands, 'review.md'), 'Review command', 'utf8');
  fs.writeFileSync(path.join(paths.notes, 'note.md'), 'Note', 'utf8');
  fs.writeFileSync(path.join(paths.extensions, 'provider.ts'), 'export default {}', 'utf8');
  fs.writeFileSync(paths.auth, '{"token":"secret"}', 'utf8');

  getOmpStatusMock = vi.fn(() => ({
    installed: true,
    agentDir: paths.agentDir,
    settingsPath: paths.settings,
    authPath: paths.auth
  }));
  readJsonFileMock = vi.fn((filePath, fallback) => {
    if (filePath === paths.modelsJsonLegacy) return { models: ['legacy-omp-model'] };
    return fallback;
  });
  readYamlFileMock = vi.fn((filePath, fallback) => {
    if (filePath === paths.settings) return { theme: 'dark', packages: ['demo-package'], disabledPackages: ['old-package'] };
    if (filePath === paths.modelsYml) return { providers: { 'ctx-demo': { models: [{ id: 'omp-model' }] } } };
    return fallback;
  });
  getOmpAuthProviderSnapshotMock = vi.fn(() => ({
    available: true,
    providers: [
      {
        id: 'openai-codex',
        name: 'ChatGPT Plus/Pro (Codex Subscription)',
        loggedIn: false,
        accountCount: 0,
        accounts: []
      }
    ],
    supportedProviders: [
      { id: 'openai-codex', name: 'ChatGPT Plus/Pro (Codex Subscription)', loginCapable: true }
    ],
    aliases: { codex: 'openai-codex' },
    checkedAt: '2026-07-08T00:00:00.000Z'
  }));

  require.cache[require.resolve('../../../src/platforms/drivers/omp/config')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/config'),
    filename: require.resolve('../../../src/platforms/drivers/omp/config'),
    loaded: true,
    exports: {
      getOmpPaths: vi.fn(() => paths),
      getOmpStatus: getOmpStatusMock,
      readJsonFile: readJsonFileMock,
      readYamlFile: readYamlFileMock
    }
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/auth-providers')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/auth-providers'),
    filename: require.resolve('../../../src/platforms/drivers/omp/auth-providers'),
    loaded: true,
    exports: {
      getOmpAuthProviderSnapshot: getOmpAuthProviderSnapshotMock
    }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/platforms/drivers/omp/api-config',
    '../../../src/platforms/drivers/omp/config',
    '../../../src/platforms/drivers/omp/auth-providers'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('omp-config api', () => {
  test('GET / returns OMP resources and capability mapping', async () => {
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status.installed).toBe(true);
    expect(res.body.capabilities.native).toEqual(expect.objectContaining({
      config: true,
      models: true,
      commands: true,
      notes: true,
      settings: true,
      extensions: true,
      skills: true,
      promptTemplates: true,
      packages: true,
      rpc: true,
      sessions: true
    }));
    expect(res.body.capabilities.mapped).toEqual(expect.objectContaining({
      command: 'commands/prompts',
      plugin: 'packages/extensions',
      mcp: 'mcp.json',
      agent: 'OMP discovery capability'
    }));
    expect(res.body.capabilities.writable).toEqual(expect.objectContaining({
      mcp: true,
      agent: false
    }));
    expect(res.body.resources.packages).toEqual(['demo-package']);
    expect(res.body.resources.auth).toEqual({ exists: true, path: paths.auth });
    expect(res.body.resources.authProviders).toBeUndefined();
    expect(res.body.resources.models.providers['ctx-demo'].models[0].id).toBe('omp-model');
    expect(res.body.resources.skills.map(item => item.name)).toContain('review-skill');
    expect(res.body.resources.prompts.map(item => item.name)).toEqual(['review.md']);
    expect(res.body.resources.commands.map(item => item.name)).toEqual(['review.md']);
    expect(res.body.resources.notes.map(item => item.name)).toEqual(['note.md']);
    expect(res.body.resources.extensions.map(item => item.name)).toEqual(['provider.ts']);
  });

  test('GET /capabilities and /resources return focused payloads', async () => {
    const app = buildApp();
    const capabilities = await request(app).get('/capabilities');
    const resources = await request(app).get('/resources');
    const authProviders = await request(app).get('/auth-providers?forceRefresh=true');

    expect(capabilities.status).toBe(200);
    expect(capabilities.body.platform).toBe('omp');
    expect(capabilities.body.capabilities.native.rpc).toBe(true);
    expect(resources.status).toBe(200);
    expect(resources.body.paths.agentDir).toBe(paths.agentDir);
    expect(resources.body.packages).toEqual(['demo-package']);
    expect(resources.body.prompts.map(item => item.name)).toEqual(['review.md']);
    expect(resources.body.commands.map(item => item.name)).toEqual(['review.md']);
    expect(authProviders.status).toBe(200);
    expect(authProviders.body.providers[0].id).toBe('openai-codex');
    expect(getOmpAuthProviderSnapshotMock).toHaveBeenCalledWith({ forceRefresh: true });
  });
});
