'use strict';

const LOADER_PATH = require.resolve('../../../src/config/loader');
const STORE_PATH = require.resolve('../../../src/shared/model-fallback-store');

let config;
let loaderStub;
let originalLoader;

function loadStore() {
  require.cache[LOADER_PATH] = { id: LOADER_PATH, filename: LOADER_PATH, loaded: true, exports: loaderStub };
  delete require.cache[STORE_PATH];
  return require(STORE_PATH);
}

beforeEach(() => {
  config = {};
  originalLoader = require.cache[LOADER_PATH];
  loaderStub = {
    loadConfig: vi.fn(() => config),
    saveConfig: vi.fn((next) => { config = next; })
  };
});

afterEach(() => {
  delete require.cache[STORE_PATH];
  if (originalLoader) require.cache[LOADER_PATH] = originalLoader;
  else delete require.cache[LOADER_PATH];
});

test('reads per-platform chains from coding-tool config', () => {
  config = {
    modelFallbackChains: {
      claude: [{ from: 'glm-4.6', targets: [{ channelId: 'b', model: 'qwen-max' }] }]
    }
  };
  const store = loadStore();

  expect(store.readPlatformChains('claude')).toEqual([
    { from: 'glm-4.6', targets: [{ channelId: 'b', model: 'qwen-max' }] }
  ]);
  expect(store.readPlatformChains('codex')).toEqual([]);
});

test('normalizes before saving and drops the key when empty', () => {
  const store = loadStore();

  store.writePlatformChains('claude', [
    { from: ' glm-4.6 ', targets: [{ channelId: 'b', model: 'qwen-max' }, { channelId: '', model: 'x' }] },
    { from: 'deprecated', targets: [] }
  ]);
  expect(config.modelFallbackChains).toEqual({
    claude: [{ from: 'glm-4.6', targets: [{ channelId: 'b', model: 'qwen-max' }] }]
  });

  store.writePlatformChains('claude', []);
  expect(config.modelFallbackChains).toBeUndefined();
});

test('lists channel/model candidates from enabled channels only', () => {
  const store = loadStore();
  const channels = [
    { id: 'a', name: 'A', enabled: true, models: ['glm-4.6', { id: 'glm-4.5-air' }], model: 'glm-4.6' },
    { id: 'b', name: 'B', models: [{ id: 'qwen-max' }] },
    { id: 'c', name: 'C', enabled: false, models: ['hidden-model'] }
  ];

  expect(store.listPlatformModelOptions(channels)).toEqual([
    { channelId: 'a', channelName: 'A', model: 'glm-4.6' },
    { channelId: 'a', channelName: 'A', model: 'glm-4.5-air' },
    { channelId: 'b', channelName: 'B', model: 'qwen-max' }
  ]);
});

test('resolves the configured targets for a model and keeps only enabled channels', () => {
  config = {
    modelFallbackChains: {
      claude: [{
        from: 'glm-4.6',
        targets: [
          { channelId: 'b', model: 'qwen-max' },
          { channelId: 'gone', model: 'x' }
        ]
      }]
    }
  };
  const store = loadStore();
  const channels = [
    { id: 'a', name: 'A', enabled: true, models: ['glm-4.6'] },
    { id: 'b', name: 'B', enabled: true, models: ['qwen-max'] }
  ];

  expect(store.resolvePlatformFallbackTargets('claude', 'glm-4.6', channels))
    .toEqual([{ channelId: 'b', model: 'qwen-max' }]);
  expect(store.resolvePlatformFallbackTargets('claude', 'unknown-model', channels)).toEqual([]);
  // 目标渠道被禁用后不再作为回退目标
  expect(store.resolvePlatformFallbackTargets('claude', 'glm-4.6', [channels[0]])).toEqual([]);
});
