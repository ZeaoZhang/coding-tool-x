const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let execSyncSpy;
let promptMock;
let validateManifestMock;
let checkVersionCompatibilityMock;
let addPluginMock;
let removePluginMock;
let getPluginMock;
let listPluginsMock;
let updatePluginRegistryMock;
let cryptoRandomBytesSpy;

function loadInstaller() {
  delete require.cache[require.resolve('../../../src/plugins/plugin-installer')];
  return require('../../../src/plugins/plugin-installer');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-installer-'));
  fs.mkdirSync(path.join(testDir, 'plugins', 'installed'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'plugins', 'config'), { recursive: true });

  promptMock = vi.fn(async () => ({ confirmed: true }));
  validateManifestMock = vi.fn(() => ({ valid: true, errors: [] }));
  checkVersionCompatibilityMock = vi.fn(() => ({ compatible: true }));
  addPluginMock = vi.fn();
  removePluginMock = vi.fn();
  getPluginMock = vi.fn(() => null);
  listPluginsMock = vi.fn(() => []);
  updatePluginRegistryMock = vi.fn();

  require.cache[require.resolve('inquirer')] = {
    id: require.resolve('inquirer'),
    filename: require.resolve('inquirer'),
    loaded: true,
    exports: { prompt: promptMock }
  };
  require.cache[require.resolve('../../../src/plugins/constants')] = {
    id: require.resolve('../../../src/plugins/constants'),
    filename: require.resolve('../../../src/plugins/constants'),
    loaded: true,
    exports: {
      PLUGINS_DIR: path.join(testDir, 'plugins'),
      CONFIG_DIR: path.join(testDir, 'plugins', 'config'),
      INSTALLED_DIR: path.join(testDir, 'plugins', 'installed')
    }
  };
  require.cache[require.resolve('../../../src/plugins/manifest-validator')] = {
    id: require.resolve('../../../src/plugins/manifest-validator'),
    filename: require.resolve('../../../src/plugins/manifest-validator'),
    loaded: true,
    exports: {
      validateManifest: validateManifestMock,
      checkVersionCompatibility: checkVersionCompatibilityMock
    }
  };
  require.cache[require.resolve('../../../src/plugins/registry')] = {
    id: require.resolve('../../../src/plugins/registry'),
    filename: require.resolve('../../../src/plugins/registry'),
    loaded: true,
    exports: {
      addPlugin: addPluginMock,
      removePlugin: removePluginMock,
      getPlugin: getPluginMock,
      listPlugins: listPluginsMock,
      updatePlugin: updatePluginRegistryMock
    }
  };

  const childProcess = require('child_process');
  execSyncSpy = vi.spyOn(childProcess, 'execSync').mockImplementation((command) => {
    if (command.startsWith('git clone')) {
      const matches = [...command.matchAll(/"([^"]+)"/g)];
      const tempDir = matches[matches.length - 1][1];
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'plugin.json'), JSON.stringify({
        name: 'demo-plugin',
        version: '1.0.0',
        description: 'Demo plugin',
        author: 'Tester',
        main: 'index.js',
        commands: [{ name: 'review' }],
        hooks: []
      }), 'utf8');
      fs.writeFileSync(path.join(tempDir, 'index.js'), 'module.exports = {};', 'utf8');
      return '';
    }
    if (String(command).includes('git pull --ff-only')) {
      return '';
    }
    return '';
  });

  const crypto = require('crypto');
  cryptoRandomBytesSpy = vi.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.from('12345678'));
});

afterEach(() => {
  execSyncSpy.mockRestore();
  cryptoRandomBytesSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/plugins/plugin-installer',
    'inquirer',
    '../../../src/plugins/constants',
    '../../../src/plugins/manifest-validator',
    '../../../src/plugins/registry'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('plugin-installer utilities and install flow', () => {
  test('validates git URLs and command conflicts', () => {
    const installer = loadInstaller();

    expect(installer.validateGitUrl('https://github.com/demo/plugin.git').valid).toBe(true);
    expect(installer.validateGitUrl('not-a-url').valid).toBe(false);
    expect(installer.checkCommandConflicts([{ name: 'start' }, { name: 'custom' }])).toMatchObject({
      conflict: true,
      conflicts: ['start']
    });
  });

  test('cancels installation when user does not confirm', async () => {
    promptMock.mockResolvedValue({ confirmed: false });
    const installer = loadInstaller();

    const result = await installer.installPlugin('https://github.com/demo/plugin.git');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cancelled/i);
  });

  test('installs plugin successfully from git url', async () => {
    const installer = loadInstaller();

    const result = await installer.installPlugin('https://github.com/demo/plugin.git');

    expect(result.success).toBe(true);
    expect(result.plugin.name).toBe('demo-plugin');
    expect(addPluginMock).toHaveBeenCalledWith('demo-plugin', expect.objectContaining({
      version: '1.0.0',
      source: 'https://github.com/demo/plugin.git'
    }));
    expect(fs.existsSync(path.join(testDir, 'plugins', 'installed', 'demo-plugin', 'plugin.json'))).toBe(true);
  });

  test('rejects install when manifest validation fails', async () => {
    validateManifestMock.mockReturnValue({
      valid: false,
      errors: [{ field: 'main', message: 'required' }]
    });
    const installer = loadInstaller();

    const result = await installer.installPlugin('https://github.com/demo/plugin.git');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid plugin\.json/i);
  });
});

describe('plugin-installer uninstall and update flows', () => {
  test('uninstalls plugin directory and config', () => {
    getPluginMock.mockReturnValue({ name: 'demo-plugin', version: '1.0.0' });
    fs.mkdirSync(path.join(testDir, 'plugins', 'installed', 'demo-plugin'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'plugins', 'config', 'demo-plugin.json'), '{"enabled":true}', 'utf8');
    const installer = loadInstaller();

    const result = installer.uninstallPlugin('demo-plugin');

    expect(result.success).toBe(true);
    expect(removePluginMock).toHaveBeenCalledWith('demo-plugin');
    expect(fs.existsSync(path.join(testDir, 'plugins', 'installed', 'demo-plugin'))).toBe(false);
  });

  test('updates plugin and reports version change', async () => {
    getPluginMock.mockReturnValue({ name: 'demo-plugin', version: '1.0.0' });
    listPluginsMock.mockReturnValue([{ name: 'demo-plugin' }]);
    const pluginDir = path.join(testDir, 'plugins', 'installed', 'demo-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'demo-plugin',
      version: '1.0.0',
      main: 'index.js'
    }), 'utf8');

    execSyncSpy.mockImplementation((command) => {
      if (String(command).includes('git pull --ff-only')) {
        fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
          name: 'demo-plugin',
          version: '1.1.0',
          main: 'index.js'
        }), 'utf8');
      }
      return '';
    });

    const installer = loadInstaller();
    const result = await installer.updatePlugin('demo-plugin');

    expect(result.success).toBe(true);
    expect(result.plugin.oldVersion).toBe('1.0.0');
    expect(result.plugin.newVersion).toBe('1.1.0');
    expect(updatePluginRegistryMock).toHaveBeenCalledWith('demo-plugin', expect.objectContaining({
      version: '1.1.0'
    }));
  });

  test('updateAllPlugins aggregates update results', async () => {
    getPluginMock.mockImplementation((name) => ({ name, version: '1.0.0' }));
    listPluginsMock.mockReturnValue([{ name: 'demo-plugin' }, { name: 'same-plugin' }]);

    const demoDir = path.join(testDir, 'plugins', 'installed', 'demo-plugin');
    const sameDir = path.join(testDir, 'plugins', 'installed', 'same-plugin');
    fs.mkdirSync(demoDir, { recursive: true });
    fs.mkdirSync(sameDir, { recursive: true });
    fs.writeFileSync(path.join(demoDir, 'plugin.json'), JSON.stringify({ name: 'demo-plugin', version: '1.0.0', main: 'index.js' }), 'utf8');
    fs.writeFileSync(path.join(sameDir, 'plugin.json'), JSON.stringify({ name: 'same-plugin', version: '1.0.0', main: 'index.js' }), 'utf8');

    execSyncSpy.mockImplementation((command, options = {}) => {
      if (String(command).includes('git pull --ff-only') && options.cwd === demoDir) {
        fs.writeFileSync(path.join(demoDir, 'plugin.json'), JSON.stringify({ name: 'demo-plugin', version: '1.1.0', main: 'index.js' }), 'utf8');
      }
      return '';
    });

    const installer = loadInstaller();
    const result = await installer.updateAllPlugins();

    expect(result.success).toBe(true);
    expect(result.summary.updated).toBe(1);
    expect(result.summary.unchanged).toBe(1);
  });
});
