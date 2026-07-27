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
    }], { modelsRunner, validateWithCli: true });

    expect(modelsRunner).toHaveBeenCalledWith('omp', ['models', '--json'], expect.objectContaining({
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
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
    }], { runtime, catalogRunner, modelsRunner, catalogFromCli: true, validateWithCli: true });

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

  test('caches explicit OMP catalog reads and always hides the Windows process', () => {
    const catalogRunner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ models: [{ id: 'cached-model' }] }),
      stderr: ''
    }));
    const manager = require('../../../src/server/services/omp-settings-manager');

    expect(manager.getOmpCatalogModels('demo', { catalogRunner })).toEqual([{ id: 'cached-model' }]);
    expect(manager.getOmpCatalogModels('demo', { catalogRunner })).toEqual([{ id: 'cached-model' }]);
    expect(catalogRunner).toHaveBeenCalledTimes(1);
    expect(catalogRunner).toHaveBeenCalledWith('omp', ['models', 'demo', '--json'], expect.objectContaining({
      timeout: 5000,
      windowsHide: true
    }));
  });

  test('uses one catalog process to resolve requested model ids for an unregistered provider', () => {
    const catalogRunner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({
        models: [
          { provider: 'ctx-other', id: 'gpt-5.6-sol', contextWindow: 128000, maxTokens: 32768 },
          { provider: 'openai', id: 'gpt-5.6-sol', contextWindow: 1050000, maxTokens: 128000 },
          { provider: 'ctx-unregistered-provider', id: 'gpt-5.6-sol', contextWindow: 2000000, maxTokens: 256000 },
          { provider: 'openai', id: 'unrequested-model' }
        ]
      }),
      stderr: ''
    }));
    const manager = require('../../../src/server/services/omp-settings-manager');

    expect(manager.getOmpCatalogModels('unregistered-provider', {
      requestedModelIds: ['gpt-5.6-sol'],
      catalogRunner
    })).toEqual([
      expect.objectContaining({
        provider: 'ctx-unregistered-provider',
        id: 'gpt-5.6-sol',
        contextWindow: 2000000,
        maxTokens: 256000
      })
    ]);
    expect(catalogRunner).toHaveBeenCalledTimes(1);
    expect(catalogRunner).toHaveBeenCalledWith('omp', ['models', '--json'], expect.objectContaining({
      timeout: 5000,
      windowsHide: true
    }));
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
      catalogFromCli: true,
      discoverDisabledProviders: true,
      validateWithCli: true,
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
    }], { modelsRunner, validateWithCli: true })).toThrow('OMP models.yml validation failed: schema failed');
  });

  test('syncs channel files without starting the OMP CLI by default', () => {
    const resolveOmpRuntime = vi.fn(() => {
      throw new Error('OMP CLI must not be probed during channel sync');
    });
    require.cache[OMP_CONFIG_PATH].exports.resolveOmpRuntime = resolveOmpRuntime;
    const modelsRunner = vi.fn();
    const catalogRunner = vi.fn();
    const manager = require('../../../src/server/services/omp-settings-manager');

    manager.writeManagedOmpProviders([{
      id: 'channel-1',
      providerKey: 'demo',
      baseUrl: 'https://demo.example/v1',
      model: 'gpt-demo'
    }], { modelsRunner, catalogRunner });

    expect(resolveOmpRuntime).not.toHaveBeenCalled();
    expect(modelsRunner).not.toHaveBeenCalled();
    expect(catalogRunner).not.toHaveBeenCalled();
    expect(yaml.load(fs.readFileSync(paths.modelsYml, 'utf8')).providers['ctx-demo']).toBeDefined();
    expect(manager.getLastManagedOmpSyncResult().validation).toEqual({
      skipped: true,
      reason: 'cli-validation-disabled',
      warnings: []
    });
  });

  test('does not invent metadata for an unknown user-added model', () => {
    const manager = require('../../../src/server/services/omp-settings-manager');
    const target = manager.writeManagedOmpProviders([{
      id: 'channel-future',
      providerKey: 'future-provider',
      baseUrl: 'https://future.example/v1',
      model: 'future-model'
    }]);

    const model = yaml.load(fs.readFileSync(target, 'utf8')).providers['ctx-future-provider'].models[0];
    expect(model).toEqual({ id: 'future-model' });
    expect(model).not.toHaveProperty('reasoning');
    expect(model).not.toHaveProperty('contextWindow');
    expect(model).not.toHaveProperty('maxTokens');
    expect(model).not.toHaveProperty('cost');
    expect(manager.normalizeModels({ model: 'claude-future-unlisted' })).toEqual([
      { id: 'claude-future-unlisted' }
    ]);
  });

  test('writes the base model once and keeps thinking effort in the default selector', () => {
    const manager = require('../../../src/server/services/omp-settings-manager');
    const target = manager.writeManagedOmpProviders([{
      id: 'channel-gpt',
      providerKey: 'openai-official',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.5:high',
      allowedModels: ['gpt-5.5']
    }]);

    const config = yaml.load(fs.readFileSync(target, 'utf8'));
    const models = config.providers['ctx-openai-official'].models;
    expect(models).toHaveLength(1);
    expect(models[0]).toEqual(expect.objectContaining({
      id: 'gpt-5.5',
      reasoning: true,
      contextWindow: 1050000,
      maxTokens: 128000,
      thinking: {
        mode: 'effort',
        efforts: ['low', 'medium', 'high', 'xhigh'],
        defaultLevel: 'medium'
      }
    }));
    expect(manager.getLastManagedOmpSyncResult().managedEnabledModels).toEqual([
      'ctx-openai-official/gpt-5.5'
    ]);
    expect(manager.getLastManagedOmpSyncResult().managedDefaultModel).toBe(
      'ctx-openai-official/gpt-5.5:high'
    );
  });

  test('round-trips complete model and provider-level OMP parameters', () => {
    const manager = require('../../../src/server/services/omp-settings-manager');
    const target = manager.writeManagedOmpProviders([{
      id: 'channel-custom',
      providerKey: 'custom',
      baseUrl: 'https://custom.example/v1',
      model: 'future-model',
      modelMetadataMode: 'manual',
      models: [{
        id: 'future-model',
        api: 'openai-responses',
        reasoning: true,
        thinking: { mode: 'effort', efforts: ['low', 'high'] },
        input: ['text'],
        supportsTools: true,
        cost: { input: 1, output: 2 },
        contextWindow: 500000,
        maxTokens: 64000,
        omitMaxOutputTokens: false,
        compat: { supportsDeveloperRole: true, maxTokensField: 'max_completion_tokens' },
        remoteCompaction: { enabled: true, endpoint: '/compact' }
      }],
      providerConfig: {
        compat: { supportsStrictMode: true },
        discovery: 'openai-models-list',
        modelOverrides: { 'future-model': { maxTokens: 32000 } },
        disableStrictTools: false,
        transport: 'pi-native'
      }
    }]);

    const provider = yaml.load(fs.readFileSync(target, 'utf8')).providers['ctx-custom'];
    expect(provider).toEqual(expect.objectContaining({
      discovery: 'openai-models-list',
      modelOverrides: { 'future-model': { maxTokens: 32000 } },
      disableStrictTools: false,
      transport: 'pi-native'
    }));
    expect(provider.models[0]).toEqual(expect.objectContaining({
      id: 'future-model',
      reasoning: true,
      supportsTools: true,
      contextWindow: 500000,
      maxTokens: 64000,
      omitMaxOutputTokens: false
    }));
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
