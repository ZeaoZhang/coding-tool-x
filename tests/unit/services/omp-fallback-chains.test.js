'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const OMP_CONFIG_MODULE = require.resolve('../../../src/platforms/drivers/omp/config');
const MODEL_ROLE_MODULE = require.resolve('../../../src/platforms/drivers/omp/model-role-settings');
const CATALOG_MODULE = require.resolve('../../../src/server/services/platform-catalog');

let agentDir;
let settingsPath;
let modelsPath;
let originalModules;
let enabledChannels;
let modelRoleSettings;

function stub(modulePath, exports) {
  if (!originalModules.has(modulePath)) {
    originalModules.set(modulePath, require.cache[modulePath]);
  }
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
}

function seedSettings(settings) {
  fs.writeFileSync(settingsPath, yaml.dump(settings), 'utf8');
}

function readSettings() {
  return yaml.load(fs.readFileSync(settingsPath, 'utf8'));
}

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-fallback-'));
  settingsPath = path.join(agentDir, 'config.yml');
  modelsPath = path.join(agentDir, 'models.yml');
  originalModules = new Map();
  enabledChannels = [{
    id: 'channel-zhipu',
    name: 'Zhipu',
    providerKey: 'zhipu',
    authMode: 'api_key',
    baseUrl: 'http://127.0.0.1:1/v1',
    models: ['glm-4.6', 'glm-4.5-air']
  }];

  fs.writeFileSync(modelsPath, yaml.dump({
    providers: {
      'ctx-zhipu': {
        baseUrl: 'http://127.0.0.1:1/v1',
        api: 'openai-completions',
        models: [{ id: 'glm-4.6' }, { id: 'glm-4.5-air' }]
      }
    }
  }), 'utf8');

  stub(CATALOG_MODULE, {
    getPlatformCatalog: () => ({
      driver: (platform, capability) => (
        platform === 'omp' && capability === 'channels'
          ? { getEnabled: () => ({ status: 'ok', data: enabledChannels }) }
          : null
      )
    })
  });

  delete require.cache[OMP_CONFIG_MODULE];
  delete require.cache[MODEL_ROLE_MODULE];
  const ompConfig = require(OMP_CONFIG_MODULE);
  ompConfig.configure({
    pathContext: {
      customized: true,
      native: {
        dir: agentDir,
        agentDir,
        config: settingsPath,
        settings: settingsPath,
        models: modelsPath,
        modelsYml: modelsPath
      }
    }
  });
  modelRoleSettings = require(MODEL_ROLE_MODULE);
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
  for (const [modulePath, previous] of originalModules) {
    if (previous) {
      require.cache[modulePath] = previous;
    } else {
      delete require.cache[modulePath];
    }
  }
});

test('reads an empty fallback config with the enabled-channel model options', () => {
  seedSettings({ modelRoles: { default: 'ctx-zhipu/glm-4.6' } });

  const result = modelRoleSettings.readOmpFallbackChainSettings();

  expect(result.chains).toEqual([]);
  expect(result.modelOptions).toEqual(['ctx-zhipu/glm-4.5-air', 'ctx-zhipu/glm-4.6']);
  expect(result).not.toHaveProperty('retry');
});

test('normalizes string chains to arrays and flags models outside enabled channels', () => {
  seedSettings({
    retry: {
      attempts: 3,
      fallbackChains: {
        'ctx-zhipu/glm-4.6': ['ctx-zhipu/glm-4.5-air', 'ctx-missing/ghost-model'],
        default: 'ctx-zhipu/glm-4.5-air'
      }
    }
  });

  const result = modelRoleSettings.readOmpFallbackChainSettings();

  expect(result.chains).toEqual([
    { trigger: 'ctx-zhipu/glm-4.6', models: ['ctx-zhipu/glm-4.5-air', 'ctx-missing/ghost-model'] },
    { trigger: 'default', models: ['ctx-zhipu/glm-4.5-air'] }
  ]);
  expect(result.unavailableChains).toEqual({
    'ctx-zhipu/glm-4.6': ['ctx-missing/ghost-model']
  });
});

test('writes chains to retry.fallbackChains and preserves the rest of the config', () => {
  seedSettings({ retry: { attempts: 3 }, modelRoles: { default: 'ctx-zhipu/glm-4.6' } });

  const result = modelRoleSettings.updateOmpFallbackChainSettings([
    { trigger: 'ctx-zhipu/glm-4.6', models: ['ctx-zhipu/glm-4.5-air'] },
    { trigger: 'default', models: ['ctx-zhipu/glm-4.6:high'] }
  ]);

  expect(result.chains).toEqual([
    { trigger: 'ctx-zhipu/glm-4.6', models: ['ctx-zhipu/glm-4.5-air'] },
    { trigger: 'default', models: ['ctx-zhipu/glm-4.6:high'] }
  ]);
  const stored = readSettings();
  expect(stored.retry).toEqual({
    attempts: 3,
    fallbackChains: {
      'ctx-zhipu/glm-4.6': ['ctx-zhipu/glm-4.5-air'],
      default: ['ctx-zhipu/glm-4.6:high']
    }
  });
  expect(stored.modelRoles).toEqual({ default: 'ctx-zhipu/glm-4.6' });
});

test('removes empty chains and drops the retry block when nothing else is configured', () => {
  seedSettings({ retry: { fallbackChains: { default: ['ctx-zhipu/glm-4.6'] } } });

  const result = modelRoleSettings.updateOmpFallbackChainSettings([]);

  expect(result.chains).toEqual([]);
  expect(readSettings()).not.toHaveProperty('retry');
});

test('rejects invalid payloads', () => {
  seedSettings({ retry: { fallbackChains: {} } });

  expect(() => modelRoleSettings.updateOmpFallbackChainSettings(null)).toThrow('chains must be an array');
  expect(() => modelRoleSettings.updateOmpFallbackChainSettings(['nope'])).toThrow('chains[] must be an object');
  expect(() => modelRoleSettings.updateOmpFallbackChainSettings([{ trigger: '  ', models: [] }]))
    .toThrow('chains[].trigger must be a non-empty string');
  expect(() => modelRoleSettings.updateOmpFallbackChainSettings([
    { trigger: 'ctx-zhipu/glm-4.6', models: [] },
    { trigger: 'ctx-zhipu/glm-4.6', models: ['ctx-zhipu/glm-4.5-air'] }
  ])).toThrow('is duplicated');
  expect(() => modelRoleSettings.updateOmpFallbackChainSettings([{
    trigger: 'ctx-zhipu/glm-4.6',
    models: Array.from({ length: 11 }, (_, index) => `ctx-zhipu/m${index}`)
  }])).toThrow('supports at most 10 fallback models');
  expect(() => modelRoleSettings.updateOmpFallbackChainSettings([{
    trigger: 'ctx-zhipu/glm-4.6',
    models: ['ctx-other/not-enabled']
  }])).toThrow('must use a model from an enabled OMP channel');
});

test('allows keeping an existing off-list model but not introducing a new one', () => {
  seedSettings({
    retry: { fallbackChains: { 'ctx-zhipu/glm-4.6': ['ctx-legacy/retired-model'] } }
  });

  const kept = modelRoleSettings.updateOmpFallbackChainSettings([{
    trigger: 'ctx-zhipu/glm-4.6',
    models: ['ctx-legacy/retired-model', 'ctx-zhipu/glm-4.5-air']
  }]);
  expect(kept.chains).toEqual([{
    trigger: 'ctx-zhipu/glm-4.6',
    models: ['ctx-legacy/retired-model', 'ctx-zhipu/glm-4.5-air']
  }]);

  expect(() => modelRoleSettings.updateOmpFallbackChainSettings([{
    trigger: 'ctx-zhipu/glm-4.6',
    models: ['ctx-legacy/another-retired']
  }])).toThrow('must use a model from an enabled OMP channel');
});

test('maps native provider/model refs into the shared UI shape', () => {
  seedSettings({
    retry: { fallbackChains: { 'ctx-zhipu/glm-4.6': ['ctx-zhipu/glm-4.5-air', 'ctx-legacy/retired-model'] } }
  });

  const ui = modelRoleSettings.readOmpFallbackChainsForUi();

  expect(ui.chains).toEqual([{
    from: 'ctx-zhipu/glm-4.6',
    targets: [
      { channelId: 'channel-zhipu', model: 'glm-4.5-air' },
      // 找不到对应渠道的 ref 保留成 provider: 伪渠道，保证可原样写回
      { channelId: 'provider:ctx-legacy', model: 'retired-model' }
    ]
  }]);
  expect(ui.modelOptions).toEqual(expect.arrayContaining([
    { channelId: 'channel-zhipu', channelName: 'Zhipu', model: 'glm-4.5-air' }
  ]));
});

test('writes the shared UI shape back as native provider/model refs', () => {
  // 已存在的历史 ref 允许原样保留（新目标仍必须来自已启用渠道）
  seedSettings({ retry: { attempts: 2, fallbackChains: { 'ctx-zhipu/glm-4.6': ['ctx-other/m2'] } } });

  const result = modelRoleSettings.updateOmpFallbackChainsForUi([{
    from: 'ctx-zhipu/glm-4.6',
    targets: [
      { channelId: 'channel-zhipu', model: 'glm-4.5-air' },
      { channelId: 'provider:ctx-other', model: 'm2' }
    ]
  }]);

  expect(readSettings().retry).toEqual({
    attempts: 2,
    fallbackChains: { 'ctx-zhipu/glm-4.6': ['ctx-zhipu/glm-4.5-air', 'ctx-other/m2'] }
  });
  expect(result.chains).toEqual([{
    from: 'ctx-zhipu/glm-4.6',
    targets: [
      { channelId: 'channel-zhipu', model: 'glm-4.5-air' },
      { channelId: 'provider:ctx-other', model: 'm2' }
    ]
  }]);
});
