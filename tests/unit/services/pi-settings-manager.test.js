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
