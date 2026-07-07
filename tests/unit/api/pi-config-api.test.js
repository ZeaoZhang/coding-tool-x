const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let testDir;
let paths;
let getPiStatusMock;
let readJsonFileMock;
let readYamlFileMock;
let readPiSettingsMock;

function buildApp() {
  delete require.cache[require.resolve('../../../src/server/api/pi-config')];
  const router = require('../../../src/server/api/pi-config');
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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-config-api-'));
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

  getPiStatusMock = vi.fn(() => ({
    installed: true,
    agentDir: paths.agentDir,
    settingsPath: paths.settings,
    authPath: paths.auth
  }));
  readJsonFileMock = vi.fn((filePath, fallback) => {
    if (filePath === paths.modelsJsonLegacy) return { models: ['legacy-pi-model'] };
    return fallback;
  });
  readYamlFileMock = vi.fn((filePath, fallback) => {
    if (filePath === paths.settings) return { theme: 'dark' };
    if (filePath === paths.modelsYml) return { providers: { 'ctx-demo': { models: [{ id: 'pi-model' }] } } };
    return fallback;
  });
  readPiSettingsMock = vi.fn(() => ({
    packages: ['demo-package'],
    disabledPackages: ['old-package']
  }));

  require.cache[require.resolve('../../../src/server/services/pi-config')] = {
    id: require.resolve('../../../src/server/services/pi-config'),
    filename: require.resolve('../../../src/server/services/pi-config'),
    loaded: true,
    exports: {
      getPiPaths: vi.fn(() => paths),
      getPiStatus: getPiStatusMock,
      readJsonFile: readJsonFileMock,
      readYamlFile: readYamlFileMock,
      readPiSettings: readPiSettingsMock
    }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/api/pi-config',
    '../../../src/server/services/pi-config'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('pi-config api', () => {
  test('GET / returns Pi resources and capability mapping', async () => {
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
      mcp: 'OMP discovery capability',
      agent: 'OMP discovery capability'
    }));
    expect(res.body.capabilities.writable).toEqual(expect.objectContaining({
      mcp: false,
      agent: false
    }));
    expect(res.body.resources.packages).toEqual(['demo-package']);
    expect(res.body.resources.auth).toEqual({ exists: true, path: paths.auth });
    expect(res.body.resources.models.providers['ctx-demo'].models[0].id).toBe('pi-model');
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

    expect(capabilities.status).toBe(200);
    expect(capabilities.body.platform).toBe('pi');
    expect(capabilities.body.capabilities.native.rpc).toBe(true);
    expect(resources.status).toBe(200);
    expect(resources.body.paths.agentDir).toBe(paths.agentDir);
    expect(resources.body.packages).toEqual(['demo-package']);
    expect(resources.body.prompts.map(item => item.name)).toEqual(['review.md']);
    expect(resources.body.commands.map(item => item.name)).toEqual(['review.md']);
  });
});
