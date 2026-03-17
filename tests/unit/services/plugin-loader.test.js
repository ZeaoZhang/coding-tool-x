const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let registryExports;
let createPluginContextMock;

function loadPluginLoader() {
  delete require.cache[require.resolve('../../../src/plugins/plugin-loader')];
  return require('../../../src/plugins/plugin-loader');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-loader-'));
  fs.mkdirSync(path.join(testDir, 'installed'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'config'), { recursive: true });

  registryExports = {
    getPlugin: vi.fn()
  };

  createPluginContextMock = vi.fn((name, config, pluginDir) => ({
    name,
    config,
    pluginDir,
    _getCommands: () => new Map()
  }));

  require.cache[require.resolve('../../../src/plugins/registry')] = {
    id: require.resolve('../../../src/plugins/registry'),
    filename: require.resolve('../../../src/plugins/registry'),
    loaded: true,
    exports: registryExports
  };
  require.cache[require.resolve('../../../src/plugins/constants')] = {
    id: require.resolve('../../../src/plugins/constants'),
    filename: require.resolve('../../../src/plugins/constants'),
    loaded: true,
    exports: {
      INSTALLED_DIR: path.join(testDir, 'installed'),
      CONFIG_DIR: path.join(testDir, 'config')
    }
  };
  require.cache[require.resolve('../../../src/plugins/plugin-api')] = {
    id: require.resolve('../../../src/plugins/plugin-api'),
    filename: require.resolve('../../../src/plugins/plugin-api'),
    loaded: true,
    exports: {
      createPluginContext: createPluginContextMock
    }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/plugins/plugin-loader',
    '../../../src/plugins/registry',
    '../../../src/plugins/constants',
    '../../../src/plugins/plugin-api'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

function writePlugin(name, files) {
  const pluginDir = path.join(testDir, 'installed', name);
  fs.mkdirSync(pluginDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(pluginDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return pluginDir;
}

describe('plugin-loader load and unload', () => {
  test('rejects missing or disabled plugins from registry', () => {
    registryExports.getPlugin.mockReturnValueOnce(null).mockReturnValueOnce({ enabled: false });
    const loader = loadPluginLoader();

    expect(loader.loadPlugin('missing')).toMatchObject({ success: false });
    expect(loader.loadPlugin('disabled')).toMatchObject({ success: false, error: expect.stringMatching(/disabled/) });
  });

  test('loads plugin successfully with parsed config', () => {
    registryExports.getPlugin.mockReturnValue({ enabled: true, version: '1.0.0' });
    writePlugin('demo-plugin', {
      'plugin.json': JSON.stringify({ name: 'demo-plugin', version: '1.0.0', main: 'index.js' }),
      'index.js': 'module.exports = { activate(ctx) { ctx.activated = true; }, deactivate() {} };'
    });
    fs.writeFileSync(path.join(testDir, 'config', 'demo-plugin.json'), JSON.stringify({ mode: 'strict' }), 'utf8');

    const loader = loadPluginLoader();
    const result = loader.loadPlugin('demo-plugin');

    expect(result.success).toBe(true);
    expect(createPluginContextMock).toHaveBeenCalledWith(
      'demo-plugin',
      { mode: 'strict' },
      path.join(testDir, 'installed', 'demo-plugin')
    );
    expect(loader.getLoadedPlugins()).toEqual(['demo-plugin']);
  });

  test('blocks path traversal in plugin main file', () => {
    registryExports.getPlugin.mockReturnValue({ enabled: true, version: '1.0.0' });
    writePlugin('bad-plugin', {
      'plugin.json': JSON.stringify({ name: 'bad-plugin', version: '1.0.0', main: '../escape.js' })
    });

    const loader = loadPluginLoader();
    const result = loader.loadPlugin('bad-plugin');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/path traversal/i);
  });

  test('returns activation failure when activate throws', () => {
    registryExports.getPlugin.mockReturnValue({ enabled: true, version: '1.0.0' });
    writePlugin('explode-plugin', {
      'plugin.json': JSON.stringify({ name: 'explode-plugin', version: '1.0.0', main: 'index.js' }),
      'index.js': 'module.exports = { activate() { throw new Error("boom"); } };'
    });

    const loader = loadPluginLoader();
    const result = loader.loadPlugin('explode-plugin');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/activation failed/i);
  });

  test('unloadPlugin deactivates when available and ignores deactivate errors', () => {
    registryExports.getPlugin.mockReturnValue({ enabled: true, version: '1.0.0' });
    writePlugin('unload-plugin', {
      'plugin.json': JSON.stringify({ name: 'unload-plugin', version: '1.0.0', main: 'index.js' }),
      'index.js': 'module.exports = { activate() {}, deactivate() { throw new Error("cleanup fail"); } };'
    });

    const loader = loadPluginLoader();
    loader.loadPlugin('unload-plugin');

    const result = loader.unloadPlugin('unload-plugin');

    expect(result.success).toBe(true);
    expect(loader.getLoadedPlugins()).toEqual([]);
  });
});
