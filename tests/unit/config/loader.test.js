/**
 * Tests for src/config/loader.js
 *
 * Pattern: inject stubs into require.cache before importing the module under
 * test. PATHS is replaced with an object whose configFile points to a per-test
 * tmpdir. event-bus is replaced with a vi.fn() stub so we can assert on it.
 * DEFAULT_CONFIG and home-dir load naturally.
 */

const os   = require('os');
const fs   = require('fs');
const path = require('path');

const LOADER_PATH    = require.resolve('../../../src/config/loader');
const PATHS_PATH     = require.resolve('../../../src/config/paths');
const EVENTBUS_PATH  = require.resolve('../../../src/plugins/event-bus');

let testDir;
let testConfigFile;
let nativeProjectsDir;

// Stable stub references – reassigned in beforeEach
let emitSync;

function injectStubs() {
  emitSync = vi.fn();

  // PATHS stub – configFile must point to testConfigFile which is set in beforeEach
  // We use a getter so the value is read lazily at call time.
  const pathsStub = {
    get PATHS() { return { configFile: testConfigFile }; },
    get NATIVE_PATHS() { return { claude: { projects: nativeProjectsDir } }; },
    ensureStorageDirMigrated: vi.fn()
  };

  require.cache[PATHS_PATH] = {
    id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
    exports: pathsStub
  };
  require.cache[EVENTBUS_PATH] = {
    id: EVENTBUS_PATH, filename: EVENTBUS_PATH, loaded: true,
    exports: { emitSync }
  };
}

let loadConfig;
let saveConfig;
let expandHome;
let resolveClaudeProjectsDir;
let normalizeConfigForSave;
let getConfigFilePath;

beforeEach(() => {
  testDir        = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-loader-test-'));
  testConfigFile = path.join(testDir, 'config.json');
  nativeProjectsDir = path.join(testDir, 'claude-native', 'projects');

  delete require.cache[LOADER_PATH];

  injectStubs();

  const loader  = require('../../../src/config/loader');
  loadConfig     = loader.loadConfig;
  saveConfig     = loader.saveConfig;
  expandHome     = loader.expandHome;
  resolveClaudeProjectsDir = loader.resolveClaudeProjectsDir;
  normalizeConfigForSave = loader.normalizeConfigForSave;
  getConfigFilePath = loader.getConfigFilePath;
});

afterEach(() => {
  delete require.cache[LOADER_PATH];
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeConfig(obj) {
  fs.mkdirSync(path.dirname(testConfigFile), { recursive: true });
  fs.writeFileSync(testConfigFile, JSON.stringify(obj, null, 2), 'utf8');
}

const DEFAULT_CONFIG = require('../../../src/config/default');
const DEFAULT_CONFIG_PATH = require.resolve('../../../src/config/default');

describe('DEFAULT_CONFIG Claude paths', () => {
  it('uses CLAUDE_CONFIG_DIR for the default projectsDir', () => {
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const customClaudeDir = path.join(testDir, 'custom-claude');

    try {
      process.env.CLAUDE_CONFIG_DIR = customClaudeDir;
      delete require.cache[DEFAULT_CONFIG_PATH];
      const isolatedDefaultConfig = require('../../../src/config/default');

      expect(isolatedDefaultConfig.projectsDir).toBe(path.join(customClaudeDir, 'projects'));
    } finally {
      if (previousClaudeConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
      }
      delete require.cache[DEFAULT_CONFIG_PATH];
      require('../../../src/config/default');
    }
  });
});

// ─── expandHome ───────────────────────────────────────────────────────────────

describe('expandHome', () => {
  it('replaces leading ~ with the home directory', () => {
    const result = expandHome('~/foo/bar');
    expect(result).not.toMatch(/^~/);
    expect(result).toMatch(/foo[/\\]bar$/);
  });

  it('does not modify absolute paths', () => {
    const abs = '/absolute/path/to/file';
    expect(expandHome(abs)).toBe(abs);
  });

  it('does not modify relative paths without ~', () => {
    expect(expandHome('relative/path')).toBe('relative/path');
  });

  it('handles bare ~', () => {
    const result = expandHome('~');
    expect(result).not.toMatch(/^~/);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── getConfigFilePath ────────────────────────────────────────────────────────

describe('getConfigFilePath', () => {
  it('returns the value from PATHS.configFile', () => {
    expect(getConfigFilePath()).toBe(testConfigFile);
  });
});

// ─── loadConfig – no file present ────────────────────────────────────────────

describe('loadConfig with no config file', () => {
  it('returns a config object', () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });

  it('returns default port values', () => {
    const config = loadConfig();
    expect(config.ports.webUI).toBe(DEFAULT_CONFIG.ports.webUI);
    expect(config.ports.proxy).toBe(DEFAULT_CONFIG.ports.proxy);
  });

  it('sets currentProject equal to defaultProject', () => {
    const config = loadConfig();
    // defaultProject is null by default; currentProject should match it
    expect(config.currentProject).toBe(config.defaultProject ?? config.currentProject);
    // At minimum, currentProject must not be set to something unrelated
    if (config.defaultProject !== undefined && config.defaultProject !== null) {
      expect(config.currentProject).toBe(config.defaultProject);
    } else {
      // Both are absent / null — verify they are consistent
      expect(config.currentProject == null).toBe(config.defaultProject == null);
    }
  });

  it('uses Claude native projectsDir at runtime without a config file', () => {
    const config = loadConfig();
    expect(config.projectsDir).toBe(nativeProjectsDir);
  });

  it('emits config:loaded event', () => {
    loadConfig();
    expect(emitSync).toHaveBeenCalledWith(
      'config:loaded',
      expect.objectContaining({ config: expect.any(Object) })
    );
  });
});

// ─── loadConfig – with existing file ─────────────────────────────────────────

describe('loadConfig with existing config file', () => {
  it('loads and merges user config with defaults', () => {
    writeConfig({ maxLogs: 42 });
    expect(loadConfig().maxLogs).toBe(42);
  });

  it('user value overrides default value', () => {
    writeConfig({ pageSize: 99 });
    expect(loadConfig().pageSize).toBe(99);
  });

  it('missing user keys fall back to defaults', () => {
    writeConfig({ maxLogs: 5 });
    expect(loadConfig().statsInterval).toBe(DEFAULT_CONFIG.statsInterval);
  });

  it('merges ports: user value overrides, others keep defaults', () => {
    writeConfig({ ports: { webUI: 8888 } });
    const config = loadConfig();
    expect(config.ports.webUI).toBe(8888);
    expect(config.ports.proxy).toBe(DEFAULT_CONFIG.ports.proxy);
    expect(config.ports.codexProxy).toBe(DEFAULT_CONFIG.ports.codexProxy);
  });

  it('sets currentProject from defaultProject when absent', () => {
    writeConfig({ defaultProject: 'my-proj' });
    expect(loadConfig().currentProject).toBe('my-proj');
  });

  it('keeps existing currentProject when present in file', () => {
    writeConfig({ currentProject: 'existing', defaultProject: 'other' });
    expect(loadConfig().currentProject).toBe('existing');
  });

  it('expands ~ in user-supplied projectsDir', () => {
    writeConfig({ projectsDir: '~/my/projects' });
    const config = loadConfig();
    expect(config.projectsDir).not.toMatch(/^~/);
    expect(config.projectsDir).toMatch(/my[/\\]projects/);
  });

  it('uses Claude native projectsDir when the config file omits projectsDir', () => {
    writeConfig({ maxLogs: 7 });
    const config = loadConfig();
    expect(config.projectsDir).toBe(nativeProjectsDir);
  });

  it('treats stale default-shaped projectsDir as native runtime path', () => {
    writeConfig({ projectsDir: path.join(testDir, 'old-home', '.claude', 'projects') });
    const config = loadConfig();
    expect(config.projectsDir).toBe(nativeProjectsDir);
  });

  it('emits config:loaded with merged config', () => {
    writeConfig({ maxLogs: 7 });
    loadConfig();
    expect(emitSync).toHaveBeenCalledWith(
      'config:loaded',
      expect.objectContaining({ config: expect.objectContaining({ maxLogs: 7 }) })
    );
  });

  it('falls back to defaults when file contains invalid JSON', () => {
    fs.mkdirSync(path.dirname(testConfigFile), { recursive: true });
    fs.writeFileSync(testConfigFile, '{ invalid json }', 'utf8');
    const config = loadConfig();
    expect(config.statsInterval).toBe(DEFAULT_CONFIG.statsInterval);
  });
});

// ─── saveConfig ───────────────────────────────────────────────────────────────

describe('saveConfig', () => {
  it('writes config as formatted JSON to the config file', () => {
    saveConfig({ maxLogs: 55, ports: { webUI: 7777 } });
    expect(fs.existsSync(testConfigFile)).toBe(true);
    const written = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));
    expect(written.maxLogs).toBe(55);
    expect(written.ports.webUI).toBe(7777);
  });

  it('creates the config directory if it does not exist', () => {
    // Use a subdirectory within testDir that does not yet exist
    const subDir  = path.join(testDir, 'deep', 'nested');
    const deep    = path.join(subDir, 'config.json');
    // Re-require loader with PATHS pointing at the deep path
    delete require.cache[LOADER_PATH];
    require.cache[PATHS_PATH] = {
      id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
      exports: {
        get PATHS() { return { configFile: deep }; },
        get NATIVE_PATHS() { return { claude: { projects: nativeProjectsDir } }; },
        ensureStorageDirMigrated: vi.fn()
      }
    };
    require.cache[EVENTBUS_PATH] = {
      id: EVENTBUS_PATH, filename: EVENTBUS_PATH, loaded: true,
      exports: { emitSync: vi.fn() }
    };
    const { saveConfig: sc } = require('../../../src/config/loader');
    sc({ test: true });
    expect(fs.existsSync(deep)).toBe(true);
  });

  it('emits config:saved event after writing', () => {
    saveConfig({ maxLogs: 10 });
    expect(emitSync).toHaveBeenCalledWith(
      'config:saved',
      expect.objectContaining({ config: expect.objectContaining({ maxLogs: 10 }) })
    );
  });

  it('written file round-trips back to the same object', () => {
    const cfg = { nested: { a: 1, b: [1, 2, 3] }, flag: true };
    saveConfig(cfg);
    const parsed = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));
    expect(parsed).toEqual(cfg);
  });

  it('omits native Claude projectsDir when saving runtime config', () => {
    saveConfig({ maxLogs: 10, projectsDir: nativeProjectsDir });
    const parsed = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));
    expect(parsed).toEqual({ maxLogs: 10 });
  });

  it('omits stale default-shaped projectsDir when saving', () => {
    saveConfig({
      maxLogs: 10,
      projectsDir: path.join(testDir, 'old-home', '.claude', 'projects')
    });
    const parsed = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));
    expect(parsed).toEqual({ maxLogs: 10 });
  });

  it('preserves custom projectsDir when saving', () => {
    const customProjectsDir = path.join(testDir, 'custom-projects');
    fs.mkdirSync(customProjectsDir, { recursive: true });

    saveConfig({ maxLogs: 10, projectsDir: customProjectsDir });
    const parsed = JSON.parse(fs.readFileSync(testConfigFile, 'utf8'));

    expect(parsed.projectsDir).toBe(customProjectsDir);
  });
});

describe('projectsDir helpers', () => {
  it('resolves absent projectsDir to Claude native projectsDir', () => {
    expect(resolveClaudeProjectsDir({})).toBe(nativeProjectsDir);
  });

  it('normalizes default projectsDir out before save', () => {
    expect(normalizeConfigForSave({ projectsDir: nativeProjectsDir })).not.toHaveProperty('projectsDir');
  });
});

// ─── pricing merge ────────────────────────────────────────────────────────────

describe('loadConfig - pricing merge', () => {
  it('preserves default pricing keys when user provides no pricing', () => {
    writeConfig({ maxLogs: 1 });
    const config = loadConfig();
    expect(config.pricing.claude).toBeDefined();
    expect(config.pricing.claude.input).toBe(DEFAULT_CONFIG.pricing.claude.input);
  });

  it('user pricing fields override defaults', () => {
    writeConfig({ pricing: { claude: { input: 999, output: 888 } } });
    const config = loadConfig();
    expect(config.pricing.claude.input).toBe(999);
    expect(config.pricing.claude.output).toBe(888);
  });

  it('pricing entries without mode default to "auto"', () => {
    writeConfig({ pricing: { claude: { input: 1 } } });
    expect(loadConfig().pricing.claude.mode).toBe('auto');
  });
});
