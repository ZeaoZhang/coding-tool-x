const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let registryFile;

function loadRegistryModule() {
  delete require.cache[require.resolve('../../../src/plugins/registry')];
  return require('../../../src/plugins/registry');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-registry-'));
  registryFile = path.join(testDir, 'plugins', 'registry.json');

  const constantsPath = require.resolve('../../../src/plugins/constants');
  require.cache[constantsPath] = {
    id: constantsPath,
    filename: constantsPath,
    loaded: true,
    exports: {
      PLUGINS_DIR: path.join(testDir, 'plugins'),
      REGISTRY_FILE: registryFile
    }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/plugins/registry',
    '../../../src/plugins/constants'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('plugin registry persistence', () => {
  test('loadRegistry creates an empty registry file when missing', () => {
    const registry = loadRegistryModule();

    expect(registry.loadRegistry()).toEqual({ plugins: {} });
    expect(JSON.parse(fs.readFileSync(registryFile, 'utf8'))).toEqual({ plugins: {} });
  });

  test('loadRegistry falls back to an empty registry on invalid JSON', () => {
    fs.mkdirSync(path.dirname(registryFile), { recursive: true });
    fs.writeFileSync(registryFile, '{bad json', 'utf8');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const registry = loadRegistryModule();
    expect(registry.loadRegistry()).toEqual({ plugins: {} });

    consoleSpy.mockRestore();
  });

  test('addPlugin, listPlugins, updatePlugin, and removePlugin persist registry state', () => {
    const registry = loadRegistryModule();

    registry.addPlugin('ctx-plugin-demo', {
      version: '1.0.0',
      source: 'https://github.com/demo/plugin.git',
      loadOrder: 5
    });

    expect(registry.getPlugin('ctx-plugin-demo')).toEqual(expect.objectContaining({
      version: '1.0.0',
      enabled: true,
      source: 'https://github.com/demo/plugin.git',
      loadOrder: 5
    }));
    expect(registry.listPlugins()).toEqual([
      expect.objectContaining({
        name: 'ctx-plugin-demo',
        version: '1.0.0'
      })
    ]);

    expect(registry.updatePlugin('ctx-plugin-demo', { enabled: false, version: '1.1.0' })).toEqual(expect.objectContaining({
      enabled: false,
      version: '1.1.0'
    }));

    registry.removePlugin('ctx-plugin-demo');
    expect(registry.getPlugin('ctx-plugin-demo')).toBeNull();
    expect(registry.listPlugins()).toEqual([]);
  });

  test('updatePlugin throws for missing plugins', () => {
    const registry = loadRegistryModule();

    expect(() => registry.updatePlugin('missing-plugin', { enabled: false })).toThrow(
      "Plugin 'missing-plugin' not found in registry"
    );
  });
});
