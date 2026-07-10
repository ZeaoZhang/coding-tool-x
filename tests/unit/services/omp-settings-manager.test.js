const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const MANAGER_PATH = require.resolve('../../../src/server/services/omp-settings-manager');
const OMP_CONFIG_PATH = require.resolve('../../../src/server/services/omp-config');

let testDir;
let paths;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-settings-manager-'));
  paths = {
    agentDir: testDir,
    config: path.join(testDir, 'config.yml'),
    settings: path.join(testDir, 'config.yml'),
    modelsYml: path.join(testDir, 'models.yml'),
    managedVisibilityState: path.join(testDir, 'omp-managed-visibility.json'),
    managedProviderExtension: path.join(testDir, 'extensions', 'coding-tool-x-provider.ts')
  };

  delete require.cache[MANAGER_PATH];
  require.cache[OMP_CONFIG_PATH] = {
    id: OMP_CONFIG_PATH,
    filename: OMP_CONFIG_PATH,
    loaded: true,
    exports: {
      getOmpPaths: () => paths,
      ensureOmpDir: (dirPath) => fs.mkdirSync(dirPath, { recursive: true })
    }
  };
});

afterEach(() => {
  delete require.cache[MANAGER_PATH];
  delete require.cache[OMP_CONFIG_PATH];
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('omp-settings-manager OMP models.yml sync', () => {
  test('writes managed ctx providers while preserving user providers', () => {
    fs.writeFileSync(paths.modelsYml, yaml.dump({
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'OPENAI_API_KEY',
          api: 'openai-responses'
        }
      }
    }), 'utf8');

    const manager = require('../../../src/server/services/omp-settings-manager');
    const target = manager.writeManagedOmpProviders([{
      id: 'channel-1',
      name: 'Demo Provider',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      apiKey: 'secret',
      providerApi: 'openai-completions',
      model: 'gpt-demo',
      allowedModels: ['gpt-demo-mini']
    }]);

    const config = yaml.load(fs.readFileSync(target, 'utf8'));
    expect(config.providers.openai).toEqual(expect.objectContaining({
      baseUrl: 'https://api.openai.com/v1'
    }));
    expect(config.providers['ctx-demo']).toEqual(expect.objectContaining({
      baseUrl: 'https://demo.example/v1',
      apiKey: 'secret',
      api: 'openai-completions'
    }));
    expect(config.providers['ctx-demo'].models.map(model => model.id)).toEqual(['gpt-demo', 'gpt-demo-mini']);
  });

  test('creates a single ctx backup before the first managed models.yml write', () => {
    const originalConfig = {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          api: 'openai-responses'
        }
      }
    };
    fs.writeFileSync(paths.modelsYml, yaml.dump(originalConfig), 'utf8');

    const manager = require('../../../src/server/services/omp-settings-manager');
    manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      model: 'gpt-demo'
    }], { now: new Date('2026-07-07T01:02:03.004Z') });
    manager.writeManagedOmpProviders([{
      id: 'channel-2',
      providerKey: 'demo-2',
      baseUrl: 'https://demo-2.example/v1',
      model: 'gpt-demo-2'
    }]);

    const backups = fs.readdirSync(testDir)
      .filter(name => name.startsWith('models.yml.ctx-backup-'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toBe('models.yml.ctx-backup-2026-07-07T01-02-03-004Z');
    expect(yaml.load(fs.readFileSync(path.join(testDir, backups[0]), 'utf8'))).toEqual(originalConfig);
  });

  test('validates OMP models.yml and records warnings when omp is available', () => {
    require.cache[OMP_CONFIG_PATH].exports.resolveOmpRuntime = vi.fn(() => ({
      runtime: 'omp',
      command: 'omp',
      installed: true
    }));
    const modelsRunner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ warnings: ['json warning'] }),
      stderr: 'stderr warning\n'
    }));

    const manager = require('../../../src/server/services/omp-settings-manager');
    manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      model: 'gpt-demo'
    }], { modelsRunner });

    expect(modelsRunner).toHaveBeenCalledWith('omp', ['models', '--json'], expect.objectContaining({
      encoding: 'utf8',
      timeout: 5000
    }));
    expect(manager.getLastManagedOmpSyncResult()).toEqual(expect.objectContaining({
      path: paths.modelsYml,
      warnings: ['stderr warning', 'json warning'],
      validation: expect.objectContaining({
        skipped: false,
        command: 'omp',
        warnings: ['stderr warning', 'json warning']
      })
    }));
  });

  test('enriches managed models from the OMP catalog when metadata is available', () => {
    const runtime = {
      runtime: 'omp',
      command: 'omp',
      installed: true
    };
    const catalogRunner = vi.fn((command, args, options) => {
      expect(command).toBe('omp');
      expect(options.encoding).toBe('utf8');
      if (args.join(' ') === 'models deepseek --json') {
        return {
          status: 0,
          stdout: JSON.stringify({
            models: [
              {
                provider: 'deepseek',
                id: 'deepseek-v4-flash',
                name: 'DeepSeek V4 Flash',
                cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
                reasoning: true,
                thinking: ['minimal', 'low', 'medium', 'high', 'xhigh'],
                input: ['text'],
                contextWindow: 1000000,
                maxTokens: 384000
              }
            ]
          }),
          stderr: ''
        };
      }
      return { status: 0, stdout: JSON.stringify({ models: [] }), stderr: '' };
    });
    const modelsRunner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ models: [] }),
      stderr: ''
    }));

    const manager = require('../../../src/server/services/omp-settings-manager');
    const target = manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'secret',
      providerApi: 'openai-completions',
      model: 'deepseek-v4-flash'
    }], { runtime, catalogRunner, modelsRunner });

    const config = yaml.load(fs.readFileSync(target, 'utf8'));
    expect(config.providers['ctx-deepseek'].models[0]).toEqual(expect.objectContaining({
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      reasoning: true,
      thinking: { mode: 'effort', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
      input: ['text'],
      cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 384000
    }));
    expect(catalogRunner).toHaveBeenCalledWith('omp', ['models', 'deepseek', '--json'], expect.any(Object));
  });

  test('syncs OMP config.yml visibility to only managed ctx model selectors', () => {
    fs.writeFileSync(paths.settings, yaml.dump({
      theme: 'dark',
      enabledModels: ['openai/gpt-5'],
      disabledProviders: ['ollama'],
      modelRoles: {
        default: 'openai/gpt-5',
        plan: 'anthropic/claude-sonnet-4-5'
      }
    }), 'utf8');
    require.cache[OMP_CONFIG_PATH].exports.resolveOmpRuntime = vi.fn(() => ({
      runtime: 'omp',
      command: 'omp',
      installed: true
    }));
    const catalogRunner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ models: [] }),
      stderr: ''
    }));
    const modelsRunner = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          models: [
            { provider: 'deepseek', id: 'deepseek-v4-flash' },
            { provider: 'nvidia', id: 'meta/llama-3.1-8b-instruct' },
            { provider: 'ctx-deepseek', id: 'deepseek-v4-flash' }
          ]
        }),
        stderr: ''
      })
      .mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ models: [] }),
        stderr: ''
      });

    const manager = require('../../../src/server/services/omp-settings-manager');
    manager.writeManagedOmpProviders([
      {
        id: 'channel-1',
        providerKey: 'deepseek',
        baseUrl: 'https://deepseek.example/v1',
        model: 'deepseek-v4-flash'
      },
      {
        id: 'channel-2',
        providerKey: 'nvidia',
        baseUrl: 'https://nvidia.example/v1',
        allowedModels: ['meta/llama-3.1-8b-instruct']
      }
    ], {
      catalogRunner,
      modelsRunner,
      now: new Date('2026-07-09T01:02:03.004Z')
    });

    const settings = yaml.load(fs.readFileSync(paths.settings, 'utf8'));
    expect(settings.theme).toBe('dark');
    expect(settings.enabledModels).toEqual([
      'ctx-deepseek/deepseek-v4-flash',
      'ctx-nvidia/meta/llama-3.1-8b-instruct'
    ]);
    expect(settings.disabledProviders).toEqual(['ollama', 'deepseek', 'nvidia']);
    expect(settings.modelRoles).toEqual({
      default: 'ctx-deepseek/deepseek-v4-flash',
      plan: 'anthropic/claude-sonnet-4-5'
    });

    const state = JSON.parse(fs.readFileSync(paths.managedVisibilityState, 'utf8'));
    expect(state.original).toEqual({
      enabledModels: ['openai/gpt-5'],
      disabledProviders: ['ollama'],
      modelRolesHadDefault: true,
      modelRolesDefault: 'openai/gpt-5'
    });
    expect(state.managedDisabledProviders).toEqual(['deepseek', 'nvidia']);
    expect(manager.getLastManagedOmpSyncResult()).toEqual(expect.objectContaining({
      settingsPath: paths.settings,
      statePath: paths.managedVisibilityState,
      settingsBackupPath: path.join(testDir, 'config.yml.ctx-backup-2026-07-09T01-02-03-004Z'),
      managedEnabledModels: [
        'ctx-deepseek/deepseek-v4-flash',
        'ctx-nvidia/meta/llama-3.1-8b-instruct'
      ],
      managedDisabledProviders: ['deepseek', 'nvidia']
    }));
  });

  test('restores original OMP config.yml visibility when managed providers are removed', () => {
    fs.writeFileSync(paths.settings, yaml.dump({
      enabledModels: ['openai/gpt-5'],
      disabledProviders: ['ollama'],
      modelRoles: {
        default: 'openai/gpt-5',
        plan: 'anthropic/claude-sonnet-4-5'
      }
    }), 'utf8');

    const manager = require('../../../src/server/services/omp-settings-manager');
    manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'deepseek',
      baseUrl: 'https://deepseek.example/v1',
      model: 'deepseek-v4-flash'
    }], { discoverDisabledProviders: false });
    manager.removeManagedOmpProviders();

    expect(fs.existsSync(paths.managedVisibilityState)).toBe(false);
    expect(yaml.load(fs.readFileSync(paths.settings, 'utf8'))).toEqual({
      enabledModels: ['openai/gpt-5'],
      disabledProviders: ['ollama'],
      modelRoles: {
        default: 'openai/gpt-5',
        plan: 'anthropic/claude-sonnet-4-5'
      }
    });
  });

  test('cleanup preserves manual OMP config.yml edits made during managed visibility', () => {
    fs.writeFileSync(paths.settings, yaml.dump({
      enabledModels: ['openai/gpt-5'],
      disabledProviders: ['ollama'],
      modelRoles: { default: 'openai/gpt-5' }
    }), 'utf8');

    const manager = require('../../../src/server/services/omp-settings-manager');
    manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'deepseek',
      baseUrl: 'https://deepseek.example/v1',
      model: 'deepseek-v4-flash'
    }], { discoverDisabledProviders: false });
    fs.writeFileSync(paths.settings, yaml.dump({
      enabledModels: ['ctx-deepseek/deepseek-v4-flash', 'manual/model'],
      disabledProviders: ['ollama', 'deepseek', 'manual-provider'],
      modelRoles: { default: 'ctx-deepseek/deepseek-v4-flash' }
    }), 'utf8');

    manager.removeManagedOmpProviders();

    expect(yaml.load(fs.readFileSync(paths.settings, 'utf8'))).toEqual({
      enabledModels: ['manual/model'],
      disabledProviders: ['ollama', 'manual-provider'],
      modelRoles: { default: 'openai/gpt-5' }
    });
    expect(manager.getLastManagedOmpSyncResult().warnings).toEqual([
      'OMP enabledModels was changed while coding-tool-x managed visibility was active; preserved non-managed entries during cleanup.',
      'OMP disabledProviders was changed while coding-tool-x managed visibility was active; removed only managed provider entries.'
    ]);
  });

  test('does not expose provider catalog when an enabled channel has no configured models', () => {
    const manager = require('../../../src/server/services/omp-settings-manager');
    manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'deepseek',
      baseUrl: 'https://deepseek.example/v1'
    }], { discoverDisabledProviders: false });

    const settings = yaml.load(fs.readFileSync(paths.settings, 'utf8'));
    expect(settings.enabledModels).toHaveLength(1);
    expect(settings.enabledModels[0]).toContain('__no_models_configured__');
    expect(settings.disabledProviders).toEqual(['deepseek']);
    expect(manager.getLastManagedOmpSyncResult().warnings[0]).toContain('has no configured models');
  });

  test('throws a clear error when OMP models.yml validation fails', () => {
    require.cache[OMP_CONFIG_PATH].exports.resolveOmpRuntime = vi.fn(() => ({
      runtime: 'omp',
      command: 'omp',
      installed: true
    }));
    const modelsRunner = vi.fn(() => ({
      status: 1,
      stdout: '',
      stderr: 'schema failed'
    }));

    const manager = require('../../../src/server/services/omp-settings-manager');

    expect(() => manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      model: 'gpt-demo'
    }], { modelsRunner })).toThrow('OMP models.yml validation failed: schema failed');
  });

  test('removes only managed ctx providers and deletes legacy extension', () => {
    fs.mkdirSync(path.dirname(paths.managedProviderExtension), { recursive: true });
    fs.writeFileSync(paths.managedProviderExtension, 'legacy extension', 'utf8');
    fs.writeFileSync(paths.modelsYml, yaml.dump({
      providers: {
        openai: { api: 'openai-responses' },
        'ctx-old': { api: 'openai-completions', models: [{ id: 'old' }] }
      }
    }), 'utf8');

    const manager = require('../../../src/server/services/omp-settings-manager');
    expect(manager.isManagedOmpProvidersActive()).toBe(true);
    manager.removeManagedOmpProviders();

    const config = yaml.load(fs.readFileSync(paths.modelsYml, 'utf8'));
    expect(config.providers).toEqual({
      openai: { api: 'openai-responses' }
    });
    expect(fs.existsSync(paths.managedProviderExtension)).toBe(false);
    expect(manager.isManagedOmpProvidersActive()).toBe(false);
  });
});
