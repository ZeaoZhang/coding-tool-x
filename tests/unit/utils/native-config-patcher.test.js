const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');
const yaml = require('js-yaml');
const {
  updateJsoncFile,
  updateYamlFile,
  updateEnvFile,
  writeTomlFile
} = require('../../../src/utils/native-config-patcher');
const { DSH_YAML_SOURCE_TAGS } = require('../../../src/platforms/drivers/dsh/common');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-config-patcher-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('updates JSONC fields while retaining comments and unrelated settings', () => {
  const filePath = path.join(testDir, 'settings.json');
  const original = '{\n  // User managed this section\n  "mcpServers": { "local": { "command": "keep" } },\n  "env": { "CHANNEL_KEY": "old" }\n}\n';
  fs.writeFileSync(filePath, original);

  updateJsoncFile(filePath, settings => {
    settings.env.CHANNEL_KEY = 'new';
  });

  const result = fs.readFileSync(filePath, 'utf8');
  expect(result).toContain('// User managed this section');
  expect(result).toContain('"mcpServers": { "local": { "command": "keep" } }');
  expect(result).toContain('"CHANNEL_KEY": "new"');
});

test('updates YAML without changing unrelated comments or timestamp values', () => {
  const filePath = path.join(testDir, 'settings.yaml');
  fs.writeFileSync(filePath, '# user settings\nupdatedAt: 2025-01-02T03:04:05Z\nservice:\n  keep: true # retain this note\n  managed: old\n');

  updateYamlFile(filePath, settings => {
    settings.service.managed = 'new';
  });

  const result = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(result);
  expect(result).toContain('# user settings');
  expect(result).toContain('# retain this note');
  expect(parsed.updatedAt).toBeInstanceOf(Date);
  expect(parsed.service.keep).toBe(true);
  expect(parsed.service.managed).toBe('new');
});

test('preserves DSH unevaluated JavaScript expressions when patching YAML', () => {
  const filePath = path.join(testDir, 'settings.yaml');
  fs.writeFileSync(filePath, 'patch: !!js process.env.GITHUB_TOKEN\nmanaged: old\n');

  updateYamlFile(filePath, settings => {
    settings.managed = 'new';
  }, { customTags: DSH_YAML_SOURCE_TAGS });

  const result = fs.readFileSync(filePath, 'utf8');
  expect(result).toContain('patch: !!js process.env.GITHUB_TOKEN');
  expect(result).toContain('managed: new');
});

test('updates only selected environment keys and keeps unrelated lines', () => {
  const filePath = path.join(testDir, '.env');
  fs.writeFileSync(filePath, '# user value\nOTHER_KEY=leave-me\nCHANNEL_KEY=old # channel comment\n');

  updateEnvFile(filePath, { CHANNEL_KEY: 'new value', OLD_CHANNEL_KEY: undefined });

  expect(fs.readFileSync(filePath, 'utf8')).toBe(
    '# user value\nOTHER_KEY=leave-me\nCHANNEL_KEY="new value" # channel comment\n'
  );
});

test('patches Codex provider config without reserializing unrelated TOML', () => {
  const filePath = path.join(testDir, 'config.toml');
  const original = [
    '# Keep this top-level note',
    'model = "gpt-5.5" # keep inline note',
    'model_provider = "managed-a"',
    '',
    '[model_providers.managed-a] # provider table note',
    '# Provider configuration note',
    'name = "Old" # keep this field note',
    'base_url = "https://old.example/v1"',
    '',
    '# Keep this other section',
    '[other]',
    'value = "unchanged"',
    ''
  ].join('\n');
  fs.writeFileSync(filePath, original);
  const config = toml.parse(original);
  config.model_providers['managed-a'].name = 'New';
  config.model_providers['managed-a'].base_url = 'https://new.example/v1';

  writeTomlFile(filePath, config, { atomic: true });

  const result = fs.readFileSync(filePath, 'utf8');
  const parsed = toml.parse(result);
  expect(parsed.model).toBe('gpt-5.5');
  expect(parsed.model_providers['managed-a']).toMatchObject({
    name: 'New',
    base_url: 'https://new.example/v1'
  });
  expect(result).toContain('# Keep this top-level note');
  expect(result).toContain('model = "gpt-5.5" # keep inline note');
  expect(result).toContain('# Keep this other section');
  expect(result).toContain('# provider table note');
  expect(result).toContain('# Provider configuration note');
  expect(result).toContain('# keep this field note');
});
