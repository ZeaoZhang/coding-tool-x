const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');

let testDir;
let configsDir;
let codexConfigPath;
let convertSkillToCodexMock;
let convertCommandToCodexMock;
let ConfigSyncManager;

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-sync-manager-'));
  configsDir = path.join(testDir, '.cc-tool', 'configs');
  codexConfigPath = path.join(testDir, '.codex', 'config.toml');

  convertSkillToCodexMock = vi.fn((content) => ({
    content: `${content}\n# converted`,
    warnings: ['skill warning']
  }));
  convertCommandToCodexMock = vi.fn((content) => ({
    content: `${content}\n# prompt`,
    warnings: ['command warning']
  }));

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        configs: configsDir
      },
      NATIVE_PATHS: {
        claude: {
          settings: path.join(testDir, '.claude', 'settings.json')
        },
        codex: {
          config: codexConfigPath
        },
        opencode: {
          config: path.join(testDir, '.config', 'opencode')
        }
      },
      HOME_DIR: testDir,
      ensureStorageDirMigrated: vi.fn()
    }
  };

  const converterPath = require.resolve('../../../src/server/services/format-converter');
  require.cache[converterPath] = {
    id: converterPath,
    filename: converterPath,
    loaded: true,
    exports: {
      convertSkillToCodex: convertSkillToCodexMock,
      convertCommandToCodex: convertCommandToCodexMock
    }
  };

  delete require.cache[require.resolve('../../../src/server/services/config-sync-manager')];
  ({ ConfigSyncManager } = require('../../../src/server/services/config-sync-manager'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/config-sync-manager',
    '../../../src/config/paths',
    '../../../src/server/services/format-converter'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('ConfigSyncManager direct sync helpers', () => {
  test('syncToClaude and removeFromClaude handle nested command files and cleanup empty dirs', () => {
    writeFile(path.join(configsDir, 'commands', 'nested', 'review.md'), 'review body');
    const manager = new ConfigSyncManager();

    const syncResult = manager.syncToClaude('commands', 'nested/review.md');
    const targetPath = path.join(testDir, '.claude', 'commands', 'nested', 'review.md');

    expect(syncResult).toEqual({
      success: true,
      target: targetPath
    });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('review body');

    const removeResult = manager.removeFromClaude('commands', 'nested/review.md');
    expect(removeResult).toEqual({ success: true });
    expect(fs.existsSync(targetPath)).toBe(false);
    expect(fs.existsSync(path.join(testDir, '.claude', 'commands', 'nested'))).toBe(false);
  });

  test('syncToCodex converts skills and preserves non-text files', () => {
    writeFile(path.join(configsDir, 'skills', 'review-skill', 'SKILL.md'), '# Skill');
    fs.mkdirSync(path.join(configsDir, 'skills', 'review-skill'), { recursive: true });
    fs.writeFileSync(path.join(configsDir, 'skills', 'review-skill', 'icon.bin'), Buffer.from([1, 2, 3]));
    const manager = new ConfigSyncManager();

    const result = manager.syncToCodex('skills', 'review-skill');
    const targetDir = path.join(testDir, '.codex', 'skills', 'review-skill');

    expect(result).toEqual({
      success: true,
      target: targetDir,
      warnings: ['skill warning']
    });
    expect(convertSkillToCodexMock).toHaveBeenCalled();
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('# converted');
    expect(fs.readFileSync(path.join(targetDir, 'icon.bin'))).toEqual(Buffer.from([1, 2, 3]));
  });

  test('syncToCodex and removeFromCodex manage agent config.toml entries and managed config files', () => {
    writeFile(
      path.join(configsDir, 'agents', 'researcher.md'),
      '---\ndescription: "Research agent"\nmodel: "gpt-4.1"\n---\nPrompt body'
    );
    const manager = new ConfigSyncManager();

    const syncResult = manager.syncToCodex('agents', 'researcher.md');
    const managedConfigPath = path.join(testDir, '.codex', 'agents', 'researcher.toml');
    const parsedConfig = toml.parse(fs.readFileSync(codexConfigPath, 'utf8'));

    expect(syncResult).toEqual({
      success: true,
      target: codexConfigPath,
      warnings: []
    });
    expect(parsedConfig.features.multi_agent).toBe(true);
    expect(parsedConfig.agents.researcher.description).toBe('Research agent');
    expect(parsedConfig.agents.researcher.config_file).toBe(managedConfigPath);
    expect(toml.parse(fs.readFileSync(managedConfigPath, 'utf8')).model).toBe('gpt-4.1');

    const removeResult = manager.removeFromCodex('agents', 'researcher.md');
    const updatedConfig = toml.parse(fs.readFileSync(codexConfigPath, 'utf8'));

    expect(removeResult).toEqual({ success: true });
    expect(updatedConfig.agents?.researcher).toBeUndefined();
    expect(fs.existsSync(managedConfigPath)).toBe(false);
  });
});

describe('ConfigSyncManager aggregation', () => {
  test('syncAll aggregates synced, removed, warnings, and errors across platforms', () => {
    const manager = new ConfigSyncManager();
    vi.spyOn(manager, 'syncToClaude').mockReturnValue({ success: true });
    vi.spyOn(manager, 'syncToCodex').mockReturnValue({ success: true, warnings: ['converted'] });
    vi.spyOn(manager, 'syncToGemini').mockReturnValue({ success: false, error: 'missing source' });
    vi.spyOn(manager, 'syncToOpenCode').mockReturnValue({ success: true });
    vi.spyOn(manager, 'removeFromClaude').mockReturnValue({ success: true });
    vi.spyOn(manager, 'removeFromCodex').mockReturnValue({ success: true, message: 'Already removed' });
    vi.spyOn(manager, 'removeFromGemini').mockReturnValue({ success: true, skipped: true });
    vi.spyOn(manager, 'removeFromOpenCode').mockReturnValue({ success: true });

    const result = manager.syncAll('skills', {
      alpha: {
        enabled: true,
        platforms: { claude: true, codex: true, gemini: true, opencode: true }
      },
      beta: {
        enabled: false,
        platforms: { claude: true, codex: false, gemini: false, opencode: false }
      }
    });

    expect(result.synced).toEqual([
      { type: 'skills', name: 'alpha', platform: 'claude' },
      { type: 'skills', name: 'alpha', platform: 'codex' },
      { type: 'skills', name: 'alpha', platform: 'opencode' }
    ]);
    expect(result.removed).toEqual([
      { type: 'skills', name: 'beta', platform: 'claude' },
      { type: 'skills', name: 'beta', platform: 'opencode' }
    ]);
    expect(result.errors).toEqual([
      { type: 'skills', name: 'alpha', platform: 'gemini', error: 'missing source' }
    ]);
    expect(result.warnings).toEqual([
      { type: 'skills', name: 'alpha', platform: 'codex', warnings: ['converted'] }
    ]);
  });
});
