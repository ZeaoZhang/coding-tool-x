const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let baseDir;
let registryPath;
let configsDir;
let ConfigRegistryService;
let getSupportedPlatforms;
let buildPlatformSupport;
function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-registry-service-'));
  baseDir = path.join(testDir, '.cc-tool');
  registryPath = path.join(baseDir, 'config-registry.json');
  configsDir = path.join(baseDir, 'configs');

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        base: baseDir,
        configRegistry: registryPath,
        configs: configsDir
      },
      NATIVE_PATHS: {
        claude: {
          settings: path.join(testDir, '.claude', 'settings.json')
        }
      }
    }
  };

  delete require.cache[require.resolve('../../../src/server/services/config-registry-service')];
  ({ ConfigRegistryService, getSupportedPlatforms, buildPlatformSupport } = require('../../../src/server/services/config-registry-service'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/config-registry-service',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('ConfigRegistryService item persistence', () => {
  test('setItem normalizes platforms, preserves createdAt, and reports stats', () => {
    const service = new ConfigRegistryService();

    const created = service.setItem('plugins', 'demo-plugin', {
      source: 'remote'
    });
    const updated = service.setItem('plugins', 'demo-plugin', {
      enabled: false,
      platforms: { opencode: true },
      source: 'local'
    });
    service.setItem('commands', 'nested/review.md', {
      enabled: true,
      platforms: { codex: true, gemini: true, opencode: true }
    });

    expect(created.platforms).toEqual({
      claude: true,
      codex: false,
      gemini: false,
      opencode: false,
      omp: false
    });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.enabled).toBe(false);
    expect(updated.platforms).toEqual({
      claude: false,
      codex: false,
      gemini: false,
      opencode: true,
      omp: false
    });

    const stats = service.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byType.plugins).toMatchObject({
      total: 1,
      enabled: 0,
      disabled: 1,
      opencode: 1
    });
    expect(stats.byPlatform).toMatchObject({
      claude: 0,
      codex: 1,
      gemini: 1,
      opencode: 2,
      omp: 0
    });
  });

  test('getConfigPath rejects traversal and removeItem deletes stored config files', () => {
    const service = new ConfigRegistryService();
    service.setItem('commands', 'nested/review.md', {
      enabled: true,
      platforms: { claude: true }
    });
    const configPath = service.getConfigPath('commands', 'nested/review.md');
    writeFile(configPath, 'review body');

    expect(() => service.getConfigPath('commands', '../escape.md')).toThrow('Invalid config name');
    expect(service.configExists('commands', 'nested/review.md')).toBe(true);
    expect(service.getConfigContent('commands', 'nested/review.md')).toBe('review body');

    expect(service.removeItem('commands', 'nested/review.md')).toBe(true);
    expect(fs.existsSync(configPath)).toBe(false);
    expect(service.getItem('commands', 'nested/review.md')).toBeNull();
  });
});

describe('ConfigRegistryService import and sync', () => {
  test('imports skills and nested commands from Claude directories', () => {
    const service = new ConfigRegistryService();
    writeFile(path.join(testDir, '.claude', 'skills', 'review-skill', 'SKILL.md'), '# skill');
    writeFile(path.join(testDir, '.claude', 'commands', 'nested', 'review.md'), '# command');

    const importedSkills = service.importFromClaude('skills');
    const importedCommands = service.importFromClaude('commands');

    expect(importedSkills).toMatchObject({
      imported: 1,
      skipped: 0,
      items: ['review-skill']
    });
    expect(importedCommands).toMatchObject({
      imported: 1,
      skipped: 0,
      items: ['nested/review.md']
    });
    expect(fs.existsSync(path.join(configsDir, 'skills', 'review-skill', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(configsDir, 'commands', 'nested', 'review.md'))).toBe(true);
    expect(service.getItem('skills', 'review-skill')).toEqual(expect.objectContaining({
      source: 'imported',
      enabled: true
    }));
  });

  test('syncRegistry removes orphaned entries and adds missing files from storage', () => {
    const service = new ConfigRegistryService();

    service.setItem('commands', 'orphan.md', {
      enabled: true,
      platforms: { claude: true }
    });
    writeFile(path.join(configsDir, 'skills', 'writer-skill', 'SKILL.md'), '# skill');
    writeFile(path.join(configsDir, 'plugins', 'demo-plugin', 'index.js'), 'module.exports = {};');
    writeFile(path.join(configsDir, 'agents', 'helper.md'), '# agent');

    const result = service.syncRegistry();

    expect(result).toEqual({
      added: 3,
      removed: 1
    });
    expect(service.getItem('commands', 'orphan.md')).toBeNull();
    expect(service.getItem('skills', 'writer-skill')).toEqual(expect.objectContaining({
      source: 'synced'
    }));
    expect(service.getItem('plugins', 'demo-plugin')).toEqual(expect.objectContaining({
      source: 'synced'
    }));
    expect(service.getItem('agents', 'helper.md')).toEqual(expect.objectContaining({
      source: 'synced'
    }));
  });
});

describe('ConfigRegistryService platform capability metadata', () => {
  test('derives supported platforms and resource support from manifest data', () => {
    const registry = {
      list: () => [{
        key: 'demo-cli',
        capabilities: { resourceSync: 'generic-filesystem' },
        resourceTypes: { skills: true, commands: true, agents: false, plugins: true }
      }, {
        key: 'unsupported-cli',
        capabilities: { resourceSync: 'unsupported' }
      }]
    };

    expect(getSupportedPlatforms(registry)).toEqual(['demo-cli', 'unsupported-cli']);
    expect(buildPlatformSupport(registry)).toEqual({
      skills: { 'demo-cli': true, 'unsupported-cli': false },
      commands: { 'demo-cli': true, 'unsupported-cli': false },
      agents: { 'demo-cli': false, 'unsupported-cli': false },
      plugins: { 'demo-cli': true, 'unsupported-cli': false }
    });
  });
  test('uses only enabled manifest platforms for config support metadata', () => {
    const calls = [];
    const registry = {
      list: (options) => {
        calls.push(options);
        return options?.enabledOnly
          ? [{ key: 'enabled-cli', enabled: true }]
          : [{ key: 'enabled-cli', enabled: true }, { key: 'disabled-cli', enabled: false }];
      }
    };

    expect(getSupportedPlatforms(registry)).toEqual(['enabled-cli']);
    expect(calls).toEqual([{ enabledOnly: true }]);
  });
});
