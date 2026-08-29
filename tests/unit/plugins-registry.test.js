const fs = require('fs');
const os = require('os');
const path = require('path');

describe('plugin registry mtime cache', () => {
  let root;
  let registryPath;
  let registryModule;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-registry-'));
    registryPath = path.join(root, 'plugins', 'registry.json');
    const constantsPath = require.resolve('../../src/plugins/constants');
    require.cache[constantsPath] = {
      id: constantsPath,
      filename: constantsPath,
      loaded: true,
      exports: { PLUGINS_DIR: path.dirname(registryPath), REGISTRY_FILE: registryPath }
    };
    delete require.cache[require.resolve('../../src/plugins/registry')];
    registryModule = require('../../src/plugins/registry');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify({ plugins: { demo: { enabled: true } } }));
  });

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true });
    delete require.cache[require.resolve('../../src/plugins/registry')];
    delete require.cache[require.resolve('../../src/plugins/constants')];
  });

  it('does not reread unchanged registry files', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    expect(registryModule.loadRegistry().plugins.demo.enabled).toBe(true);
    expect(registryModule.loadRegistry().plugins.demo.enabled).toBe(true);
    expect(readSpy.mock.calls.filter(([filePath]) => filePath === registryPath)).toHaveLength(1);
  });

  it('updates the in-memory cache after saving', () => {
    registryModule.saveRegistry({ plugins: { next: { enabled: false } } });
    expect(registryModule.loadRegistry()).toEqual({ plugins: { next: { enabled: false } } });
  });
});
