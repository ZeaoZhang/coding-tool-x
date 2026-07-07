const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const MANAGER_PATH = require.resolve('../../../src/server/services/pi-settings-manager');
const PI_CONFIG_PATH = require.resolve('../../../src/server/services/pi-config');

let testDir;
let paths;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-settings-manager-'));
  paths = {
    agentDir: testDir,
    modelsYml: path.join(testDir, 'models.yml'),
    managedProviderExtension: path.join(testDir, 'extensions', 'coding-tool-x-provider.ts')
  };

  delete require.cache[MANAGER_PATH];
  require.cache[PI_CONFIG_PATH] = {
    id: PI_CONFIG_PATH,
    filename: PI_CONFIG_PATH,
    loaded: true,
    exports: {
      getPiPaths: () => paths,
      ensurePiDir: (dirPath) => fs.mkdirSync(dirPath, { recursive: true })
    }
  };
});

afterEach(() => {
  delete require.cache[MANAGER_PATH];
  delete require.cache[PI_CONFIG_PATH];
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('pi-settings-manager OMP models.yml sync', () => {
  test('writes managed ctx providers while preserving user providers', () => {
    fs.writeFileSync(paths.modelsYml, yaml.dump({
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'OPENAI_API_KEY',
          api: 'openai-responses'
        }
      }
    }), 'utf8');

    const manager = require('../../../src/server/services/pi-settings-manager');
    const target = manager.writeManagedOmpProviders([{
      id: 'channel-1',
      name: 'Demo Provider',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      apiKey: 'secret',
      providerApi: 'openai-completions',
      model: 'gpt-demo',
      allowedModels: ['gpt-demo-mini']
    }]);

    const config = yaml.load(fs.readFileSync(target, 'utf8'));
    expect(config.providers.openai).toEqual(expect.objectContaining({
      baseUrl: 'https://api.openai.com/v1'
    }));
    expect(config.providers['ctx-demo']).toEqual(expect.objectContaining({
      baseUrl: 'https://demo.example/v1',
      apiKey: 'secret',
      api: 'openai-completions'
    }));
    expect(config.providers['ctx-demo'].models.map(model => model.id)).toEqual(['gpt-demo', 'gpt-demo-mini']);
  });

  test('creates a single ctx backup before the first managed models.yml write', () => {
    const originalConfig = {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          api: 'openai-responses'
        }
      }
    };
    fs.writeFileSync(paths.modelsYml, yaml.dump(originalConfig), 'utf8');

    const manager = require('../../../src/server/services/pi-settings-manager');
    manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      model: 'gpt-demo'
    }], { now: new Date('2026-07-07T01:02:03.004Z') });
    manager.writeManagedOmpProviders([{
      id: 'channel-2',
      providerKey: 'demo-2',
      baseUrl: 'https://demo-2.example/v1',
      model: 'gpt-demo-2'
    }]);

    const backups = fs.readdirSync(testDir)
      .filter(name => name.startsWith('models.yml.ctx-backup-'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toBe('models.yml.ctx-backup-2026-07-07T01-02-03-004Z');
    expect(yaml.load(fs.readFileSync(path.join(testDir, backups[0]), 'utf8'))).toEqual(originalConfig);
  });

  test('validates OMP models.yml and records warnings when omp is available', () => {
    require.cache[PI_CONFIG_PATH].exports.resolvePiRuntime = vi.fn(() => ({
      runtime: 'omp',
      command: 'omp',
      installed: true
    }));
    const modelsRunner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ warnings: ['json warning'] }),
      stderr: 'stderr warning\n'
    }));

    const manager = require('../../../src/server/services/pi-settings-manager');
    manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      model: 'gpt-demo'
    }], { modelsRunner });

    expect(modelsRunner).toHaveBeenCalledWith('omp', ['models', '--json'], expect.objectContaining({
      encoding: 'utf8',
      timeout: 5000
    }));
    expect(manager.getLastManagedOmpSyncResult()).toEqual(expect.objectContaining({
      path: paths.modelsYml,
      warnings: ['stderr warning', 'json warning'],
      validation: expect.objectContaining({
        skipped: false,
        command: 'omp',
        warnings: ['stderr warning', 'json warning']
      })
    }));
  });

  test('throws a clear error when OMP models.yml validation fails', () => {
    require.cache[PI_CONFIG_PATH].exports.resolvePiRuntime = vi.fn(() => ({
      runtime: 'omp',
      command: 'omp',
      installed: true
    }));
    const modelsRunner = vi.fn(() => ({
      status: 1,
      stdout: '',
      stderr: 'schema failed'
    }));

    const manager = require('../../../src/server/services/pi-settings-manager');

    expect(() => manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      model: 'gpt-demo'
    }], { modelsRunner })).toThrow('OMP models.yml validation failed: schema failed');
  });

  test('removes only managed ctx providers and deletes legacy extension', () => {
    fs.mkdirSync(path.dirname(paths.managedProviderExtension), { recursive: true });
    fs.writeFileSync(paths.managedProviderExtension, 'legacy extension', 'utf8');
    fs.writeFileSync(paths.modelsYml, yaml.dump({
      providers: {
        openai: { api: 'openai-responses' },
        'ctx-old': { api: 'openai-completions', models: [{ id: 'old' }] }
      }
    }), 'utf8');

    const manager = require('../../../src/server/services/pi-settings-manager');
    expect(manager.isManagedOmpProvidersActive()).toBe(true);
    manager.removeManagedOmpProviders();

    const config = yaml.load(fs.readFileSync(paths.modelsYml, 'utf8'));
    expect(config.providers).toEqual({
      openai: { api: 'openai-responses' }
    });
    expect(fs.existsSync(paths.managedProviderExtension)).toBe(false);
    expect(manager.isManagedOmpProvidersActive()).toBe(false);
  });
});
