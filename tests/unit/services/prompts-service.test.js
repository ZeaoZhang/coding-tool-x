const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let globalClaudeDir;

function stubModules() {
  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        claude: {
          dir: globalClaudeDir,
          settings: path.join(globalClaudeDir, 'settings.json')
        },
        opencode: { config: path.join(testDir, 'opencode') },
        gemini: { env: path.join(testDir, 'gemini', '.env') },
        omp: {
          dir: path.join(testDir, 'omp-agent'),
          prompts: path.join(testDir, 'omp-agent', 'prompts')
        }
      },
      PATHS: {
        prompts: path.join(testDir, 'store', 'prompts.json')
      }
    }
  };

  const homeDirPath = require.resolve('../../../src/utils/home-dir');
  require.cache[homeDirPath] = {
    id: homeDirPath,
    filename: homeDirPath,
    loaded: true,
    exports: {
      resolvePreferredHomeDir: () => testDir
    }
  };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-service-'));
  globalClaudeDir = path.join(testDir, 'custom-claude');
  stubModules();
  delete require.cache[require.resolve('../../../src/server/services/prompts-service')];
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/prompts-service',
    '../../../src/config/paths',
    '../../../src/utils/home-dir'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('prompts-service initialization and preset management', () => {
  test('initializes with builtins and imports existing Claude prompt as current preset', () => {
    const claudePromptPath = path.join(globalClaudeDir, 'CLAUDE.md');
    fs.mkdirSync(path.dirname(claudePromptPath), { recursive: true });
    fs.writeFileSync(claudePromptPath, '# Existing prompt', 'utf8');

    const promptsService = require('../../../src/server/services/prompts-service');
    const result = promptsService.getAllPresets();

    expect(result.activePresetId).toBe('current');
    expect(result.presets.current.content).toBe('# Existing prompt');
    expect(Object.keys(result.presets)).toContain('tpl-code-review');
  });

  test('savePreset normalizes apps and deletePreset prevents builtin removal', () => {
    const promptsService = require('../../../src/server/services/prompts-service');

    const saved = promptsService.savePreset({
      id: 'custom',
      name: 'Custom',
      content: 'hello',
      apps: { claude: true, omp: true }
    });

    expect(saved.apps).toEqual({
      claude: true,
      codex: true,
      gemini: true,
      opencode: false,
      omp: true
    });
    expect(() => promptsService.deletePreset('tpl-code-review')).toThrow(/内置模板/);
    expect(promptsService.deletePreset('custom')).toBe(true);
  });
});

describe('prompts-service platform sync', () => {
  test('activatePreset writes to enabled platform prompt files', async () => {
    const promptsService = require('../../../src/server/services/prompts-service');
    promptsService.savePreset({
      id: 'team-preset',
      name: 'Team Preset',
      content: 'team instructions',
      apps: { claude: true, codex: false, gemini: true, opencode: true, omp: true }
    });

    const preset = await promptsService.activatePreset('team-preset');
    const ompTemplatePath = path.join(testDir, 'omp-agent', 'prompts', 'coding-tool-x', 'team-preset.md');

    expect(preset.id).toBe('team-preset');
    expect(fs.readFileSync(path.join(globalClaudeDir, 'CLAUDE.md'), 'utf8')).toBe('team instructions');
    expect(fs.existsSync(path.join(testDir, '.codex', 'AGENTS.md'))).toBe(false);
    expect(fs.readFileSync(path.join(testDir, '.gemini', 'GEMINI.md'), 'utf8')).toBe('team instructions');
    expect(fs.readFileSync(path.join(testDir, 'opencode', 'AGENTS.md'), 'utf8')).toBe('team instructions');
    expect(fs.readFileSync(ompTemplatePath, 'utf8')).toContain('team instructions');
    expect(fs.readFileSync(ompTemplatePath, 'utf8')).toContain('description: "Team Preset"');
  });

  test('deactivatePrompt clears active preset and removes prompt files', async () => {
    const promptsService = require('../../../src/server/services/prompts-service');
    promptsService.savePreset({
      id: 'team-preset',
      name: 'Team Preset',
      content: 'team instructions',
      apps: { claude: true, omp: true }
    });
    await promptsService.activatePreset('team-preset');
    const userTemplate = path.join(testDir, 'omp-agent', 'prompts', 'user-owned.md');
    fs.mkdirSync(path.dirname(userTemplate), { recursive: true });
    fs.writeFileSync(userTemplate, 'keep me', 'utf8');

    const result = await promptsService.deactivatePrompt();
    const active = promptsService.getActivePreset();

    expect(result.claude).toBe(true);
    expect(result.omp).toBe(true);
    expect(active.activePresetId).toBeNull();
    expect(fs.existsSync(path.join(globalClaudeDir, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(testDir, 'omp-agent', 'prompts', 'coding-tool-x', 'team-preset.md'))).toBe(false);
    expect(fs.existsSync(userTemplate)).toBe(true);
  });

  test('activating a different OMP preset removes the previous managed template', async () => {
    const promptsService = require('../../../src/server/services/prompts-service');
    promptsService.savePreset({
      id: 'first',
      name: 'First',
      content: 'first instructions',
      apps: { omp: true, claude: false, codex: false, gemini: false, opencode: false }
    });
    promptsService.savePreset({
      id: 'second',
      name: 'Second',
      content: 'second instructions',
      apps: { omp: true, claude: false, codex: false, gemini: false, opencode: false }
    });

    await promptsService.activatePreset('first');
    await promptsService.activatePreset('second');

    expect(fs.existsSync(path.join(testDir, 'omp-agent', 'prompts', 'coding-tool-x', 'first.md'))).toBe(false);
    expect(fs.readFileSync(path.join(testDir, 'omp-agent', 'prompts', 'coding-tool-x', 'second.md'), 'utf8')).toContain('second instructions');
  });
});

describe('prompts-service import and stats', () => {
  test('imports preset from platform file and reports stats', () => {
    const codexPromptPath = path.join(testDir, '.codex', 'AGENTS.md');
    fs.mkdirSync(path.dirname(codexPromptPath), { recursive: true });
    fs.writeFileSync(codexPromptPath, 'codex prompt', 'utf8');

    const promptsService = require('../../../src/server/services/prompts-service');
    const imported = promptsService.importFromPlatform('codex', 'Imported Codex');
    const platformStatus = promptsService.getPlatformStatus();
    const stats = promptsService.getStats();

    expect(imported.name).toBe('Imported Codex');
    expect(imported.apps.codex).toBe(true);
    expect(platformStatus.codex.exists).toBe(true);
    expect(platformStatus.omp.path).toBe(path.join(testDir, 'omp-agent', 'prompts'));
    expect(Array.isArray(platformStatus.omp.templates)).toBe(true);
    expect(stats.total).toBeGreaterThanOrEqual(4);
  });

  test('readPlatformPrompt rejects invalid platforms through service', () => {
    const promptsService = require('../../../src/server/services/prompts-service');

    expect(() => promptsService.readPlatformPrompt('invalid')).toThrow(/无效的平台/);
  });
});
