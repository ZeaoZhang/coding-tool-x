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

function stubDynamicPromptRuntime(driver) {
  const runtime = require('../../../src/platforms/runtime');
  const definitions = [
    { key: 'demo-cli', capabilities: { prompts: 'generic-prompt' } },
    { key: 'mcp-only', capabilities: { mcp: 'generic-mcp' } }
  ];
  const byKey = new Map(definitions.map(definition => [definition.key, definition]));
  const registry = {
    list: () => definitions,
    resolve: key => byKey.get(String(key).trim().toLowerCase()) || null,
    getCapability: (key, capability) => byKey.get(String(key).trim().toLowerCase())?.capabilities?.[capability] || null
  };
  const platformRuntime = {
    getDriver: vi.fn(() => driver)
  };
  const registrySpy = vi.spyOn(runtime, 'getPlatformRegistry').mockReturnValue(registry);
  const runtimeSpy = vi.spyOn(runtime, 'getPlatformRuntime').mockReturnValue(platformRuntime);
  return () => {
    registrySpy.mockRestore();
    runtimeSpy.mockRestore();
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

describe('legacy prompt file adapters', () => {
  test('reads, writes, and removes fixed native prompt files', () => {
    const promptsService = require('../../../src/server/services/prompts-service');
    const cases = [
      ['claude', path.join(globalClaudeDir, 'CLAUDE.md')],
    ];

    for (const [platform, promptPath] of cases) {
      expect(promptsService.writePlatformPrompt(platform, `${platform} prompt`)).toBe(`${platform} prompt`);
      expect(promptsService.readPlatformPrompt(platform)).toBe(`${platform} prompt`);
      expect(promptsService.removePlatformPrompt(platform)).toBe(true);
      expect(fs.existsSync(promptPath)).toBe(false);
    }

    expect(() => promptsService.writePlatformPrompt('omp', 'unsupported')).toThrow(/prompts capability/);
    expect(() => promptsService.removePlatformPrompt('omp')).toThrow(/prompts capability/);
  });
});
describe('registry-driven prompt platforms', () => {
  it('reads, writes, removes, syncs, and imports a generic prompt capability', async () => {
    let content = 'generic prompt';
    const driver = {
      read: vi.fn(async () => content),
      write: vi.fn(async value => {
        content = value;
        return { status: 'ok', capability: 'prompts', operation: 'write' };
      }),
      remove: vi.fn(async () => {
        content = '';
        return { status: 'ok', capability: 'prompts', operation: 'remove' };
      })
    };
    const restore = stubDynamicPromptRuntime(driver);
    const promptsService = require('../../../src/server/services/prompts-service');

    try {
      expect(await promptsService.readPlatformPrompt('demo-cli')).toBe('generic prompt');
      expect(await promptsService.writePlatformPrompt('demo-cli', 'updated prompt')).toBe('updated prompt');

      const preset = promptsService.savePreset({
        id: 'generic-preset',
        name: 'Generic preset',
        content: 'preset content',
        apps: { 'demo-cli': true, omp: false }
      });
      await promptsService.activatePreset(preset.id);
      expect(content).toBe('preset content');

      const imported = await promptsService.importFromPlatform('demo-cli', 'Imported generic');
      expect(imported.name).toBe('Imported generic');
      expect(imported.apps['demo-cli']).toBe(true);

      expect(await promptsService.removePlatformPrompt('demo-cli')).toBe(true);
      expect(driver.write).toHaveBeenCalled();
      expect(driver.remove).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('returns typed errors for unknown and non-prompt platforms', () => {
    const restore = stubDynamicPromptRuntime({
      read: vi.fn(async () => 'prompt'),
      write: vi.fn(async () => ({ status: 'ok', capability: 'prompts', operation: 'write' })),
      remove: vi.fn(async () => ({ status: 'ok', capability: 'prompts', operation: 'remove' }))
    });
    const promptsService = require('../../../src/server/services/prompts-service');

    try {
      expect(() => promptsService.readPlatformPrompt('missing-cli')).toThrow(/无效的平台/);
      expect(() => promptsService.readPlatformPrompt('mcp-only')).toThrow(/prompts capability/);
    } finally {
      restore();
    }
  });
});
