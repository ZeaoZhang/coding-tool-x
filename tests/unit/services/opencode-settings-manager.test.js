'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PATHS_PATH = require.resolve('../../../src/config/paths');
const MODEL_META_PATH = require.resolve('../../../src/config/model-metadata');
const MODULE_PATH = require.resolve('../../../src/server/services/opencode-settings-manager');

let testDir;
let configDir;
let manager;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-settings-manager-'));
  configDir = path.join(testDir, '.opencode');

  delete require.cache[MODULE_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        opencode: {
          config: configDir
        }
      }
    }
  };
  require.cache[MODEL_META_PATH] = {
    id: MODEL_META_PATH,
    filename: MODEL_META_PATH,
    loaded: true,
    exports: {
      resolveModelMetadata: vi.fn((modelId) => {
        const known = {
          'claude-sonnet': {
            limit: { context: 200000, output: 8192 },
            pricing: { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 }
          },
          'claude-haiku': {
            limit: { context: 200000, output: 4096 },
            pricing: { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1 }
          },
          'gpt-4o': {
            limit: { context: 128000, output: 16384 },
            pricing: { input: 5, output: 15, cacheRead: 0.5, cacheCreation: 1.25 }
          },
          'gpt-4o-mini': {
            limit: { context: 128000, output: 16384 },
            pricing: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheCreation: 0.03 }
          }
        };
        return known[modelId] || null;
      })
    }
  };

  manager = require('../../../src/server/services/opencode-settings-manager');
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [MODULE_PATH, PATHS_PATH, MODEL_META_PATH].forEach((mod) => {
    delete require.cache[mod];
  });
});

describe('opencode-settings-manager file selection and parsing', () => {
  test('selects jsonc first and parses comments correctly', () => {
    const jsoncPath = path.join(configDir, 'opencode.jsonc');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(jsoncPath, [
      '{',
      '  // line comment',
      '  "model": "gpt-4o",',
      '  /* block comment */',
      '  "provider": { "manual": { "options": { "baseURL": "https://api.example.com" } } }',
      '}'
    ].join('\n'), 'utf8');

    expect(manager.selectConfigPath()).toBe(jsoncPath);
    expect(manager.readConfig(jsoncPath)).toEqual({
      model: 'gpt-4o',
      provider: {
        manual: {
          options: { baseURL: 'https://api.example.com' }
        }
      }
    });
  });
});

describe('opencode-settings-manager proxy configuration', () => {
  test('writes per-channel proxy providers, preserves unmanaged providers, and exposes proxy status', () => {
    const configPath = path.join(configDir, 'opencode.json');
    writeJson(configPath, {
      provider: {
        manual: {
          options: {
            baseURL: 'https://manual.example.com',
            apiKey: 'manual-key'
          }
        },
        openai: {
          options: {
            baseURL: 'http://127.0.0.1:9999/v1',
            apiKey: 'PROXY_KEY'
          }
        }
      },
      model: 'openai/old-model'
    });

    const result = manager.setProxyConfig(4321, {
      channels: [
        {
          name: 'Claude One',
          providerKey: 'Claude One',
          model: 'claude-sonnet',
          models: ['claude-sonnet', 'claude-haiku']
        },
        {
          name: 'Claude One',
          providerKey: 'Claude One',
          model: 'claude-haiku',
          models: ['claude-haiku']
        }
      ]
    });

    const config = manager.readConfig(configPath);

    expect(result).toEqual({
      success: true,
      port: 4321,
      path: configPath
    });
    expect(config.provider.manual).toEqual({
      options: {
        baseURL: 'https://manual.example.com',
        apiKey: 'manual-key'
      }
    });
    expect(config.provider['claude-one']).toEqual(expect.objectContaining({
      npm: '@ai-sdk/openai-compatible',
      name: 'Claude One',
      options: {
        baseURL: 'http://127.0.0.1:4321/v1',
        apiKey: 'PROXY_KEY'
      },
      models: {
        'claude-sonnet': {
          name: 'claude-sonnet',
          limit: { context: 200000, output: 8192 },
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 }
        },
        'claude-haiku': {
          name: 'claude-haiku',
          limit: { context: 200000, output: 4096 },
          cost: { input: 0.8, output: 4, cache_read: 0.08, cache_write: 1 }
        }
      }
    }));
    expect(config.provider['claude-one-2']).toEqual(expect.objectContaining({
      name: 'Claude One'
    }));
    expect(config.model).toBe('claude-one/claude-sonnet');
    expect(manager.isProxyConfig()).toBe(true);
    expect(manager.getCurrentProxyPort()).toBe(4321);
  });

  test('sets and clears managed channel providers while keeping unrelated providers', () => {
    const configPath = path.join(configDir, 'opencode.json');
    writeJson(configPath, {
      provider: {
        manual: {
          options: {
            baseURL: 'https://manual.example.com',
            apiKey: 'manual-key'
          }
        }
      }
    });

    const configured = manager.setChannelConfig({
      name: 'Custom Channel',
      providerKey: 'Custom Channel',
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'channel-key',
      model: 'gpt-4o',
      allowedModels: ['gpt-4o-mini'],
      modelRedirects: [{ from: 'legacy-model', to: 'gpt-4o' }]
    });

    expect(configured).toEqual({
      success: true,
      path: configPath,
      providerKey: 'custom-channel',
      model: 'custom-channel/gpt-4o'
    });
    expect(manager.readConfig(configPath)).toEqual({
      provider: {
        manual: {
          options: {
            baseURL: 'https://manual.example.com',
            apiKey: 'manual-key'
          }
        },
        'custom-channel': {
          __ctx_managed__: true,
          npm: '@ai-sdk/openai-compatible',
          name: 'Custom Channel',
          options: {
            baseURL: 'https://router.example.com/v1',
            apiKey: 'channel-key'
          },
          models: {
            'gpt-4o': {
              name: 'gpt-4o',
              limit: { context: 128000, output: 16384 },
              cost: { input: 5, output: 15, cache_read: 0.5, cache_write: 1.25 }
            },
            'gpt-4o-mini': {
              name: 'gpt-4o-mini',
              limit: { context: 128000, output: 16384 },
              cost: { input: 0.15, output: 0.6, cache_read: 0.015, cache_write: 0.03 }
            },
            'legacy-model': {
              name: 'legacy-model'
            }
          }
        }
      },
      model: 'custom-channel/gpt-4o'
    });

    expect(manager.clearManagedChannelConfig()).toEqual({
      success: true,
      path: configPath
    });
    expect(manager.readConfig(configPath)).toEqual({
      provider: {
        manual: {
          options: {
            baseURL: 'https://manual.example.com',
            apiKey: 'manual-key'
          }
        }
      }
    });
  });

  test('restores sentinel backups by removing proxy-created config files', () => {
    const result = manager.setProxyConfig(9876, { model: 'gpt-4o' });
    expect(manager.hasBackup()).toBe(true);
    expect(fs.existsSync(result.path)).toBe(true);

    expect(manager.restoreSettings()).toEqual({ success: true });
    expect(fs.existsSync(result.path)).toBe(false);
    expect(manager.hasBackup()).toBe(false);
  });
});
