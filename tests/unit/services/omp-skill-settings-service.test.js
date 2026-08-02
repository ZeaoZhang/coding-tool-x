const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_MODULE = require.resolve('../../../src/server/services/omp-config');
const SERVICE_MODULE = require.resolve('../../../src/server/services/omp-skill-settings-service');

const DEFAULT_SETTINGS = Object.freeze({
  enableCodexUser: true,
  enableClaudeUser: true,
  enablePiUser: true,
  enablePiProject: true
});

let testDir;
let configPath;
let originalPiAgentDir;
let originalOmpAgentDir;
let originalOmpCommand;

function loadService() {
  delete require.cache[SERVICE_MODULE];
  return require(SERVICE_MODULE);
}

function writeConfig(config, options) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(config), options);
}

function readConfig() {
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-skill-settings-'));
  configPath = path.join(testDir, 'agent', 'config.yml');
  originalPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  originalOmpAgentDir = process.env.OMP_CODING_AGENT_DIR;
  originalOmpCommand = process.env.OMP_COMMAND;
  process.env.PI_CODING_AGENT_DIR = path.dirname(configPath);
  delete process.env.OMP_CODING_AGENT_DIR;
  process.env.OMP_COMMAND = `missing-omp-skill-settings-${process.pid}`;
  delete require.cache[SERVICE_MODULE];
  delete require.cache[CONFIG_MODULE];
});

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[SERVICE_MODULE];
  delete require.cache[CONFIG_MODULE];
  fs.rmSync(testDir, { recursive: true, force: true });
  if (originalPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiAgentDir;
  if (originalOmpAgentDir === undefined) delete process.env.OMP_CODING_AGENT_DIR;
  else process.env.OMP_CODING_AGENT_DIR = originalOmpAgentDir;
  if (originalOmpCommand === undefined) delete process.env.OMP_COMMAND;
  else process.env.OMP_COMMAND = originalOmpCommand;
});

test('exports only the read and update service functions', () => {
  expect(Object.keys(loadService()).sort()).toEqual([
    'readOmpSkillSettings',
    'updateOmpSkillSettings'
  ]);
});

test('returns four true defaults when config.yml or its skills node is absent', () => {
  const { readOmpSkillSettings } = loadService();

  expect(readOmpSkillSettings()).toEqual(DEFAULT_SETTINGS);
  writeConfig({ providers: { demo: {} } });
  expect(readOmpSkillSettings()).toEqual(DEFAULT_SETTINGS);
});

test('returns only managed boolean fields and defaults only absent fields', () => {
  writeConfig({
    skills: {
      enabled: 'unchecked',
      enableCodexUser: false,
      enablePiProject: false,
      customDirectories: { any: 'type is preserved' }
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

test.each([
  ['string', 'skills: enabled\n'],
  ['array', 'skills:\n  - enabled\n'],
  ['null', 'skills: null\n']
])('rejects %s skills for GET, empty PUT, and non-empty PUT without changing bytes', (_type, source) => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from(source);
  fs.writeFileSync(configPath, original);
  const { readOmpSkillSettings, updateOmpSkillSettings } = loadService();

  expect(() => readOmpSkillSettings()).toThrow('Invalid OMP config skills');
  expect(() => updateOmpSkillSettings({})).toThrow('Invalid OMP config skills');
  expect(() => updateOmpSkillSettings({ enablePiUser: false })).toThrow('Invalid OMP config skills');
  expect(fs.readFileSync(configPath)).toEqual(original);
  expect(fs.readdirSync(path.dirname(configPath))).toEqual(['config.yml']);
});

test.each([
  ['enableCodexUser', 'null'],
  ['enableClaudeUser', '0'],
  ['enablePiUser', "'false'"],
  ['enablePiProject', '[]']
])('rejects non-boolean persisted %s for GET and all PUT variants without changing bytes', (key, value) => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from(`skills:\n  ${key}: ${value}\n  customDirectories: invalid-but-unmanaged\n`);
  fs.writeFileSync(configPath, original);
  const { readOmpSkillSettings, updateOmpSkillSettings } = loadService();

  expect(() => readOmpSkillSettings()).toThrow(`Invalid OMP skill setting value for ${key}: expected boolean`);
  expect(() => updateOmpSkillSettings({})).toThrow(`Invalid OMP skill setting value for ${key}: expected boolean`);
  expect(() => updateOmpSkillSettings({ enableCodexUser: false })).toThrow(
    `Invalid OMP skill setting value for ${key}: expected boolean`
  );
  expect(fs.readFileSync(configPath)).toEqual(original);
  expect(fs.readdirSync(path.dirname(configPath))).toEqual(['config.yml']);
});

test('partially updates valid YAML and preserves all unrelated settings', () => {
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

test('rejects damaged YAML for GET and PUT without changing the original bytes', () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from('skills:\n  [broken\n');
  fs.writeFileSync(configPath, original);
  const { readOmpSkillSettings, updateOmpSkillSettings } = loadService();

  expect(() => readOmpSkillSettings()).toThrow();
  expect(() => updateOmpSkillSettings({})).toThrow();
  expect(() => updateOmpSkillSettings({ enablePiUser: false })).toThrow();
  expect(fs.readFileSync(configPath)).toEqual(original);
});

test.each(['null\n', '[]\n', 'enabled\n', ''])('rejects non-object YAML config %j without changing bytes', (source) => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from(source);
  fs.writeFileSync(configPath, original);
  const { readOmpSkillSettings, updateOmpSkillSettings } = loadService();

  expect(() => readOmpSkillSettings()).toThrow('Invalid OMP config');
  expect(() => updateOmpSkillSettings({})).toThrow('Invalid OMP config');
  expect(() => updateOmpSkillSettings({ enablePiUser: false })).toThrow('Invalid OMP config');
  expect(fs.readFileSync(configPath)).toEqual(original);
});

test('returns the valid projection for an empty patch without changing bytes or mtime', () => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = Buffer.from('providers:\n  demo: {}\nskills:\n  enablePiUser: false\n');
  fs.writeFileSync(configPath, original);
  const timestamp = new Date('2020-01-02T03:04:05.000Z');
  fs.utimesSync(configPath, timestamp, timestamp);
  const before = fs.statSync(configPath);
  const { updateOmpSkillSettings } = loadService();

  expect(updateOmpSkillSettings({})).toEqual({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: false,
    enablePiProject: true
  });
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

  expect(() => updateOmpSkillSettings(patch)).toThrow(message);
  expect(fs.existsSync(configPath)).toBe(false);
});
