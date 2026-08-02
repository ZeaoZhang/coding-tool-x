const path = require('path');

const CONFIG_MODULE = require.resolve('../../../src/server/services/omp-config');
const SERVICE_MODULE = path.resolve(
  __dirname,
  '../../../src/server/services/omp-skill-settings-service.js'
);

let persisted;
let readOmpSettings;
let writeOmpSettings;

beforeEach(() => {
  persisted = {};
  readOmpSettings = vi.fn(() => structuredClone(persisted));
  writeOmpSettings = vi.fn((next) => {
    persisted = structuredClone(next);
  });

  require.cache[CONFIG_MODULE] = {
    id: CONFIG_MODULE,
    filename: CONFIG_MODULE,
    loaded: true,
    exports: { readOmpSettings, writeOmpSettings }
  };
  delete require.cache[SERVICE_MODULE];
});

afterEach(() => {
  delete require.cache[SERVICE_MODULE];
  delete require.cache[CONFIG_MODULE];
});

test('returns true defaults for every managed scan source', () => {
  const { readOmpSkillSettings } = require(SERVICE_MODULE);

  expect(readOmpSkillSettings()).toEqual({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: true
  });
});

test('returns only managed fields and preserves persisted booleans', () => {
  persisted = {
    skills: {
      enabled: false,
      enableCodexUser: false,
      customDirectories: ['/opt/skills']
    }
  };
  const { readOmpSkillSettings } = require(SERVICE_MODULE);

  expect(readOmpSkillSettings()).toEqual({
    enableCodexUser: false,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: true
  });
});

test('partially updates one scan source', () => {
  persisted = { skills: { enableCodexUser: false } };
  const { updateOmpSkillSettings } = require(SERVICE_MODULE);

  expect(updateOmpSkillSettings({ enablePiProject: false })).toEqual({
    enableCodexUser: false,
    enableClaudeUser: true,
    enablePiUser: true,
    enablePiProject: false
  });
});

test('preserves unrelated top-level and skills fields', () => {
  persisted = {
    theme: 'night',
    skills: {
      enabled: false,
      customDirectories: ['/opt/skills'],
      enableClaudeUser: true
    }
  };
  const { updateOmpSkillSettings } = require(SERVICE_MODULE);

  updateOmpSkillSettings({ enableClaudeUser: false });

  expect(persisted).toEqual({
    theme: 'night',
    skills: {
      enabled: false,
      customDirectories: ['/opt/skills'],
      enableClaudeUser: false
    }
  });
});

test.each([
  [{ enabled: false }, /Invalid OMP skill setting: enabled/],
  [{ enableAgentsUser: false }, /Invalid OMP skill setting: enableAgentsUser/],
  [{ enablePiUser: 'false' }, /expected boolean/],
  [null, /expected an object/],
  [[], /expected an object/]
])('rejects invalid patch without writing it', (patch, message) => {
  persisted = { skills: { enabled: true } };
  const before = structuredClone(persisted);
  const { updateOmpSkillSettings } = require(SERVICE_MODULE);

  expect(() => updateOmpSkillSettings(patch)).toThrow(message);
  expect(writeOmpSettings).not.toHaveBeenCalled();
  expect(persisted).toEqual(before);
});

test('accepts an empty patch without destroying existing config', () => {
  persisted = {
    providers: { demo: {} },
    skills: { enablePiUser: false }
  };
  const { updateOmpSkillSettings } = require(SERVICE_MODULE);

  expect(updateOmpSkillSettings({})).toEqual({
    enableCodexUser: true,
    enableClaudeUser: true,
    enablePiUser: false,
    enablePiProject: true
  });
  expect(persisted).toEqual({
    providers: { demo: {} },
    skills: { enablePiUser: false }
  });
});
