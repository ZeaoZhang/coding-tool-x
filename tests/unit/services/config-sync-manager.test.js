const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');

let testDir;
let configsDir;
let codexConfigPath;
let convertSkillToCodexMock;
let convertCommandToCodexMock;
let convertCommandToGeminiMock;
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
  convertCommandToGeminiMock = vi.fn((content) => ({
    content: 'prompt = "Run fix"\n',
    warnings: content.includes('allowed-tools')
      ? ['allowed-tools 字段在 Gemini commands 中不支持，已忽略']
      : []
  }));

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        configs: configsDir,
        skillArtifacts: path.join(testDir, '.cc-tool', 'skill-artifacts')
      },
      NATIVE_PATHS: {
        claude: {
          dir: path.join(testDir, 'custom-claude'),
          settings: path.join(testDir, '.claude', 'settings.json')
        },
        codex: {
          config: codexConfigPath
        },
        gemini: {
          dir: path.join(testDir, '.gemini')
        },
        opencode: {
          config: path.join(testDir, '.config', 'opencode')
        },
        omp: {
          dir: path.join(testDir, '.omp', 'agent'),
          skills: path.join(testDir, '.omp', 'agent', 'skills'),
          commands: path.join(testDir, '.omp', 'agent', 'commands'),
          prompts: path.join(testDir, '.omp', 'agent', 'prompts'),
          extensions: path.join(testDir, '.omp', 'agent', 'extensions')
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
      convertCommandToCodex: convertCommandToCodexMock,
      convertCommandToGemini: convertCommandToGeminiMock
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
    const targetPath = path.join(testDir, 'custom-claude', 'commands', 'nested', 'review.md');

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

  test('syncToClaude accepts a validated controlled artifact source path', () => {
    const sourceDir = path.join(testDir, '.cc-tool', 'skill-artifacts', 'claude', 'override');
    writeFile(path.join(sourceDir, 'SKILL.md'), '# Controlled artifact');
    const manager = new ConfigSyncManager();

    const result = manager.syncToClaude('skills', 'override', sourceDir);

    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(testDir, 'custom-claude', 'skills', 'override', 'SKILL.md'), 'utf8'))
      .toBe('# Controlled artifact');
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

  test('syncToGemini writes command TOML and agent markdown files', () => {
    writeFile(
      path.join(configsDir, 'commands', 'git', 'fix.md'),
      '---\ndescription: "Fix issues"\nallowed-tools: Bash\n---\nRun fix'
    );
    writeFile(
      path.join(configsDir, 'agents', 'reviewer.md'),
      '---\nname: Reviewer\ndescription: "Review changes"\n---\nReview carefully'
    );
    const manager = new ConfigSyncManager();

    const commandResult = manager.syncToGemini('commands', 'git/fix.md');
    const agentResult = manager.syncToGemini('agents', 'reviewer.md');
    const commandTarget = path.join(testDir, '.gemini', 'commands', 'git', 'fix.toml');
    const agentTarget = path.join(testDir, '.gemini', 'agents', 'reviewer.md');

    expect(commandResult).toEqual({
      success: true,
      target: commandTarget,
      warnings: ['allowed-tools 字段在 Gemini commands 中不支持，已忽略']
    });
    expect(fs.readFileSync(commandTarget, 'utf8')).toContain('prompt = "Run fix"');
    expect(agentResult).toEqual({ success: true, target: agentTarget });
    expect(fs.readFileSync(agentTarget, 'utf8')).toContain('Review carefully');

    expect(manager.removeFromGemini('commands', 'git/fix.md')).toEqual({ success: true });
    expect(manager.removeFromGemini('agents', 'reviewer.md')).toEqual({ success: true });
    expect(fs.existsSync(commandTarget)).toBe(false);
    expect(fs.existsSync(agentTarget)).toBe(false);
  });

  test('syncToOmp maps skills, commands, and plugins while skipping native agents', () => {
    writeFile(path.join(configsDir, 'skills', 'review-skill', 'SKILL.md'), '# Skill');
    writeFile(path.join(configsDir, 'commands', 'team', 'review.md'), 'Review this');
    writeFile(path.join(configsDir, 'plugins', 'demo-extension', 'index.ts'), 'export default {}');
    writeFile(path.join(configsDir, 'agents', 'reviewer.md'), '# Agent');
    const manager = new ConfigSyncManager();

    const skillResult = manager.syncToOmp('skills', 'review-skill');
    const commandResult = manager.syncToOmp('commands', 'team/review.md');
    const pluginResult = manager.syncToOmp('plugins', 'demo-extension');
    const agentResult = manager.syncToOmp('agents', 'reviewer.md');

    const skillTarget = path.join(testDir, '.omp', 'agent', 'skills', 'review-skill');
    const commandTarget = path.join(testDir, '.omp', 'agent', 'commands', 'team', 'review.md');
    const pluginTarget = path.join(testDir, '.omp', 'agent', 'extensions', 'demo-extension');

    expect(skillResult).toEqual({ success: true, target: skillTarget });
    expect(commandResult).toEqual({ success: true, target: commandTarget });
    expect(pluginResult).toEqual({ success: true, target: pluginTarget });
    expect(agentResult).toEqual({ success: true, skipped: true, reason: 'Not supported natively by OMP' });
    expect(fs.readFileSync(path.join(skillTarget, 'SKILL.md'), 'utf8')).toBe('# Skill');
    expect(fs.readFileSync(commandTarget, 'utf8')).toBe('Review this');
    expect(fs.readFileSync(path.join(pluginTarget, 'index.ts'), 'utf8')).toBe('export default {}');

    expect(manager.removeFromOmp('commands', 'team/review.md')).toEqual({ success: true });
    expect(manager.removeFromOmp('plugins', 'demo-extension')).toEqual({ success: true });
    expect(fs.existsSync(commandTarget)).toBe(false);
    expect(fs.existsSync(pluginTarget)).toBe(false);
  });
});

describe('ConfigSyncManager aggregation', () => {
  test('syncAll aggregates synced, removed, warnings, and errors across platforms', () => {
    const manager = new ConfigSyncManager();
    vi.spyOn(manager, 'syncToClaude').mockReturnValue({ success: true });
    vi.spyOn(manager, 'syncToCodex').mockReturnValue({ success: true, warnings: ['converted'] });
    vi.spyOn(manager, 'syncToGemini').mockReturnValue({ success: false, error: 'missing source' });
    vi.spyOn(manager, 'syncToOpenCode').mockReturnValue({ success: true });
    vi.spyOn(manager, 'syncToOmp').mockReturnValue({ success: true });
    vi.spyOn(manager, 'removeFromClaude').mockReturnValue({ success: true });
    vi.spyOn(manager, 'removeFromCodex').mockReturnValue({ success: true, message: 'Already removed' });
    vi.spyOn(manager, 'removeFromGemini').mockReturnValue({ success: true, skipped: true });
    vi.spyOn(manager, 'removeFromOpenCode').mockReturnValue({ success: true });
    vi.spyOn(manager, 'removeFromOmp').mockReturnValue({ success: true, skipped: true });

    const result = manager.syncAll('skills', {
      alpha: {
        enabled: true,
        platforms: { claude: true, codex: true, gemini: true, opencode: true, omp: true }
      },
      beta: {
        enabled: false,
        platforms: { claude: true, codex: false, gemini: false, opencode: false, omp: false }
      }
    });

    expect(result.synced).toEqual([
      { type: 'skills', name: 'alpha', platform: 'claude' },
      { type: 'skills', name: 'alpha', platform: 'codex' },
      { type: 'skills', name: 'alpha', platform: 'opencode' },
      { type: 'skills', name: 'alpha', platform: 'omp' }
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

  test('syncAll discovers and syncs a generic platform from the registry', () => {
    const sync = vi.fn(() => ({ status: 'ok', target: '/tmp/demo/skills/review' }));
    const remove = vi.fn(() => ({ status: 'ok' }));
    const manager = new ConfigSyncManager({
      registry: {
        list: () => [{
          key: 'demo-cli',
          capabilities: { resourceSync: 'generic-filesystem' }
        }]
      },
      runtime: {
        getDriver: () => ({ sync, remove })
      }
    });

    const result = manager.syncAll('skills', {
      review: { enabled: true, platforms: { 'demo-cli': true } }
    });

    expect(sync).toHaveBeenCalledWith('skills', 'review');
    expect(result.synced).toContainEqual({ type: 'skills', name: 'review', platform: 'demo-cli' });
  });
});
