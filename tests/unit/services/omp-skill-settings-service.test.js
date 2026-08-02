const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_MODULE = require.resolve('../../../src/server/services/omp-config');
const SERVICE_MODULE = path.resolve(
  __dirname,
  '../../../src/server/services/omp-skill-settings-service.js'
);

let testDir;
let configPath;

function loadService() {
  delete require.cache[SERVICE_MODULE];
  return require(SERVICE_MODULE);
}

function writeConfig(config, options) {
  fs.writeFileSync(configPath, yaml.dump(config), options);
}

function readConfig() {
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-skill-settings-'));
  configPath = path.join(testDir, 'agent', 'config.yml');

  require.cache[CONFIG_MODULE] = {
    id: CONFIG_MODULE,
    filename: CONFIG_MODULE,
    loaded: true,
    exports: {
      getOmpPaths: vi.fn(() => ({ settings: configPath })),
      ensureOmpDir: vi.fn((dirPath) => fs.mkdirSync(dirPath, { recursive: true }))
    }
  };
  delete require.cache[SERVICE_MODULE];
});

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[SERVICE_MODULE];
  delete require.cache[CONFIG_MODULE];
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('exports only the read and update service functions', () => {
  expect(Object.keys(loadService()).sort()).toEqual([
    'readOmpSkillSettings',
    'updateOmpSkillSettings'
  ]);
});

test('returns true defaults when config.yml does not exist', () => {
  const { readOmpSkillSettings } = loadService();

  expect(readOmpSkillSettings()).toEqual({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: true
  });
});

test('returns only managed fields and defaults invalid managed values', () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeConfig({
    skills: {
      enabled: false,
      enableCodexUser: false,
      enableClaudeUser: null,
      enablePiUser: 0,
      enablePiProject: false,
      customDirectories: ['/opt/skills']
    }
  });
  const { readOmpSkillSettings } = loadService();

  expect(readOmpSkillSettings()).toEqual({
    enableCodexUser: false,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: false
  });
});

test('partially updates valid YAML and preserves unrelated OMP config', () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeConfig({
    providers: { demo: { apiKey: 'secret' } },
    skills: {
      enabled: false,
      customDirectories: ['/opt/skills'],
      enableCodexUser: false
    }
  }, { mode: 0o640 });
  const { readOmpSkillSettings, updateOmpSkillSettings } = loadService();

  expect(updateOmpSkillSettings({ enablePiProject: false })).toEqual({
    enableCodexUser: false,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: false
  });
  expect(readOmpSkillSettings()).toEqual({
    enableCodexUser: false,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: false
  });
  expect(readConfig()).toEqual({
    providers: { demo: { apiKey: 'secret' } },
    skills: {
      enabled: false,
      customDirectories: ['/opt/skills'],
      enableCodexUser: false,
      enablePiProject: false
    }
  });
  expect(fs.statSync(configPath).mode & 0o777).toBe(0o640);
});

test('creates a new config.yml with mode 0600', () => {
  const { updateOmpSkillSettings } = loadService();

  updateOmpSkillSettings({ enablePiUser: false });

  expect(readConfig()).toEqual({ skills: { enablePiUser: false } });
  expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
});

test('rejects a damaged YAML update without changing the original bytes', () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const damaged = Buffer.from('skills:\n  [broken\n');
  fs.writeFileSync(configPath, damaged);
  const { updateOmpSkillSettings } = loadService();

  expect(() => updateOmpSkillSettings({ enablePiUser: false })).toThrow();
  expect(fs.readFileSync(configPath)).toEqual(damaged);
});

test.each(['null\n', '[]\n', 'enabled\n'])(
  'rejects non-object YAML config %j',
  (source) => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, source, 'utf8');
    const { readOmpSkillSettings, updateOmpSkillSettings } = loadService();

    expect(() => readOmpSkillSettings()).toThrow('Invalid OMP config');
    expect(() => updateOmpSkillSettings({ enablePiUser: false })).toThrow('Invalid OMP config');
  }
);

test.each([
  ['string', 'skills: enabled\n'],
  ['array', 'skills:\n  - enabled\n'],
  ['null', 'skills: null\n']
])('rejects %s skills before a non-empty update without writing', (_type, source) => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from(source);
  fs.writeFileSync(configPath, original);
  const writeSpy = vi.spyOn(fs, 'writeFileSync');
  const { updateOmpSkillSettings } = loadService();

  expect(() => updateOmpSkillSettings({ enablePiUser: false })).toThrow('Invalid OMP config skills');
  expect(writeSpy).not.toHaveBeenCalled();
  expect(fs.readFileSync(configPath)).toEqual(original);
  expect(fs.readdirSync(path.dirname(configPath))).toEqual(['config.yml']);
});

test.each([
  ['string', 'skills: enabled\n'],
  ['array', 'skills:\n  - enabled\n'],
  ['null', 'skills: null\n']
])('projects defaults from %s skills for an empty patch without writing', (_type, source) => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from(source);
  fs.writeFileSync(configPath, original);
  const writeSpy = vi.spyOn(fs, 'writeFileSync');
  const { updateOmpSkillSettings } = loadService();

  expect(updateOmpSkillSettings({})).toEqual({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: true
  });
  expect(writeSpy).not.toHaveBeenCalled();
  expect(fs.readFileSync(configPath)).toEqual(original);
  expect(fs.readdirSync(path.dirname(configPath))).toEqual(['config.yml']);
});

test('keeps the original bytes and removes the temp file when rename fails', () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from('providers:\n  demo: {}\nskills:\n  enabled: false\n');
  fs.writeFileSync(configPath, original);
  const renameError = new Error('rename failed');
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
    throw renameError;
  });
  const { updateOmpSkillSettings } = loadService();

  expect(() => updateOmpSkillSettings({ enablePiUser: false })).toThrow(renameError);
  expect(fs.readFileSync(configPath)).toEqual(original);
  expect(fs.readdirSync(path.dirname(configPath))).toEqual(['config.yml']);
});

test('preserves the rename error when temporary file cleanup also fails', () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from('skills:\n  enablePiUser: true\n');
  fs.writeFileSync(configPath, original);
  const renameError = new Error('rename failed');
  const cleanupError = new Error('cleanup failed');
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
    throw renameError;
  });
  const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
    throw cleanupError;
  });
  const { updateOmpSkillSettings } = loadService();

  try {
    expect(() => updateOmpSkillSettings({ enablePiUser: false })).toThrow(renameError);
    expect(fs.readFileSync(configPath)).toEqual(original);
    expect(fs.readdirSync(path.dirname(configPath))).toHaveLength(2);
  } finally {
    unlinkSpy.mockRestore();
    for (const entry of fs.readdirSync(path.dirname(configPath))) {
      if (entry !== path.basename(configPath)) {
        fs.unlinkSync(path.join(path.dirname(configPath), entry));
      }
    }
  }
});

test('returns the projection for an empty patch without changing bytes or mtime', () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from('providers:\n  demo: {}\nskills:\n  enablePiUser: false\n');
  fs.writeFileSync(configPath, original);
  const timestamp = new Date('2020-01-02T03:04:05.000Z');
  fs.utimesSync(configPath, timestamp, timestamp);
  const before = fs.statSync(configPath);
  const writeSpy = vi.spyOn(fs, 'writeFileSync');
  const { updateOmpSkillSettings } = loadService();

  expect(updateOmpSkillSettings({})).toEqual({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: false,
    enablePiProject: true
  });
  expect(writeSpy).not.toHaveBeenCalled();
  expect(fs.readFileSync(configPath)).toEqual(original);
  expect(fs.statSync(configPath).mtimeMs).toBe(before.mtimeMs);
});

test.each([
  [{ enabled: false }, /Invalid OMP skill setting: enabled/],
  [{ enableAgentsUser: false }, /Invalid OMP skill setting: enableAgentsUser/],
  [{ enablePiUser: 'false' }, /expected boolean/],
  [null, /expected an object/],
  [[], /expected an object/]
])('rejects invalid patch without writing it', (patch, message) => {
  const { updateOmpSkillSettings } = loadService();
  const writeSpy = vi.spyOn(fs, 'writeFileSync');

  expect(() => updateOmpSkillSettings(patch)).toThrow(message);
  expect(writeSpy).not.toHaveBeenCalled();
  expect(fs.existsSync(configPath)).toBe(false);
});
