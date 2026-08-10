const fs = require('fs');
const os = require('os');
const path = require('path');

const PATHS_MODULE = require.resolve('../../../src/config/paths');
const OMP_CONFIG_MODULE = require.resolve('../../../src/server/services/omp-config');
const OMP_SETTINGS_MODULE = require.resolve('../../../src/server/services/omp-settings-manager');
const OMP_CHANNELS_MODULE = require.resolve('../../../src/server/services/omp-channels');
const CHANNEL_SYNC_MODULE = require.resolve('../../../src/server/services/channel-sync-utils');
const GENERATED_ROUTE = 'http://127.0.0.1:20092/omp/aaaaaaaaaaaaaaaaaaaaaaaa';
const GENERATED_KEY = `ctx_${'b'.repeat(40)}`;

let testDir;
let channelsPath;
let ompAgentDir;
let gatewaySecretPath;
let originalPathEnv;
let modelsConfig;
let settingsConfig;
let service;
let writeManagedOmpProviders;
let removeManagedOmpProviders;
let isManagedOmpProvidersActive;

function normalizeProviderId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'coding-tool-x';
}

function normalizeProviderApi(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'openai' || normalized === 'chat' || normalized === 'chat.completions') {
    return 'openai-completions';
  }
  if (normalized === 'responses') {
    return 'openai-responses';
  }
  return normalized;
}

function injectStubs() {
  require.cache[PATHS_MODULE] = {
    id: PATHS_MODULE,
    filename: PATHS_MODULE,
    loaded: true,
    exports: {
      PATHS: {
        channels: {
          omp: channelsPath
        },
        activeChannel: {
          omp: path.join(testDir, 'active-omp.json')
        },
        ompGatewaySecret: gatewaySecretPath
      },
      ensureStorageDirMigrated: vi.fn()
    }
  };

  require.cache[OMP_CONFIG_MODULE] = {
    id: OMP_CONFIG_MODULE,
    filename: OMP_CONFIG_MODULE,
    loaded: true,
    exports: {
      getOmpPaths: vi.fn(() => ({
        agentDir: ompAgentDir,
        modelsYml: path.join(ompAgentDir, 'models.yml'),
        settings: path.join(ompAgentDir, 'config.yml')
      }))
    }
  };

  require.cache[OMP_SETTINGS_MODULE] = {
    id: OMP_SETTINGS_MODULE,
    filename: OMP_SETTINGS_MODULE,
    loaded: true,
    exports: {
      writeManagedOmpProviders,
      removeManagedOmpProviders,
      isManagedOmpProvidersActive,
      getLastManagedOmpSyncResult: vi.fn(() => null),
      readModelsConfig: vi.fn(() => modelsConfig),
      readOmpSettingsConfig: vi.fn(() => settingsConfig),
      normalizeProviderId,
      normalizeProviderApi
    }
  };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-ch-'));
  channelsPath = path.join(testDir, 'channels', 'omp.json');
  gatewaySecretPath = path.join(testDir, 'runtime', 'omp-gateway-secret');
  ompAgentDir = path.join(testDir, 'agent');
  fs.mkdirSync(ompAgentDir, { recursive: true });
  originalPathEnv = process.env.PATH;
  modelsConfig = { providers: {} };
  settingsConfig = {};
  writeManagedOmpProviders = vi.fn();
  removeManagedOmpProviders = vi.fn();
  isManagedOmpProvidersActive = vi.fn(() => false);

  delete require.cache[OMP_CHANNELS_MODULE];
  delete require.cache[CHANNEL_SYNC_MODULE];
  delete require.cache[OMP_CONFIG_MODULE];
  injectStubs();
  service = require('../../../src/server/services/omp-channels');
});

afterEach(() => {
  delete process.env.OMP_CURRENT_KEY;
  process.env.PATH = originalPathEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    OMP_CHANNELS_MODULE,
    CHANNEL_SYNC_MODULE,
    OMP_CONFIG_MODULE,
    OMP_SETTINGS_MODULE,
    PATHS_MODULE
  ].forEach((mod) => {
    delete require.cache[mod];
  });
});

function seedChannels(channels) {
  fs.mkdirSync(path.dirname(channelsPath), { recursive: true });
  fs.writeFileSync(channelsPath, JSON.stringify({ channels }, null, 2), 'utf8');
}

function makeChannel(id, overrides = {}) {
  return {
    id,
    name: id,
    providerKey: id,
    baseUrl: `https://${id}.example/v1`,
    apiKey: `${id}-key`,
    model: `${id}-model`,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

describe('managed provider activation lifecycle', () => {
  it('persists managed mode intent independently from ctx provider files', () => {
    expect(service.isManagedOmpModeEnabled()).toBe(false);

    service.enableManagedOmpMode('channel-a', {
      host: '127.0.0.1',
      port: 20092,
      secret: 'gateway-secret'
    });

    expect(service.isManagedOmpModeEnabled()).toBe(true);
    expect(service.loadManagedOmpActiveChannelId()).toBe('channel-a');
    expect(service.loadManagedOmpModeState()).toEqual({
      version: 2,
      activeChannelId: 'channel-a',
      gateway: {
        host: '127.0.0.1',
        port: 20092,
        secret: 'gateway-secret',
        supportedOAuthChannelIds: []
      }
    });

    service.disableManagedOmpMode();

    expect(service.isManagedOmpModeEnabled()).toBe(false);
    expect(service.loadManagedOmpActiveChannelId()).toBe(null);
  });

  it('keeps the active direct provider synchronized while managed mode is disabled', () => {
    seedChannels([
      makeChannel('channel-a', {
        models: [{ id: 'old-model' }]
      }),
      makeChannel('channel-b', { enabled: false })
    ]);

    service.updateChannel('channel-a', {
      model: 'new-model',
      models: [{ id: 'new-model' }]
    });

    expect(writeManagedOmpProviders).toHaveBeenCalledTimes(1);
    expect(writeManagedOmpProviders).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'channel-a',
        model: 'new-model',
        models: [{ id: 'new-model' }]
      })
    ], {});
    expect(removeManagedOmpProviders).not.toHaveBeenCalled();
  });

  it('keeps managed providers synchronized while managed mode is enabled', () => {
    seedChannels([makeChannel('channel-a')]);
    const markerPath = path.join(testDir, 'active-omp.json');
    fs.writeFileSync(markerPath, JSON.stringify({
      version: 2,
      activeChannelId: 'channel-a',
      gateway: {
        host: '127.0.0.1',
        port: 20092,
        secret: 'gateway-secret'
      }
    }), 'utf8');

    service.updateChannel('channel-a', { name: 'updated' });

    expect(writeManagedOmpProviders).toHaveBeenCalledTimes(1);
    expect(writeManagedOmpProviders).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'channel-a', name: 'updated' })],
      {
        gateway: {
          host: '127.0.0.1',
          port: 20092,
          secret: 'gateway-secret'
        },
        activeChannelId: 'channel-a'
      }
    );
  });

  it('restores channel enablement when static provider activation fails', () => {
    seedChannels([
      makeChannel('channel-a', { enabled: false }),
      makeChannel('channel-b', { enabled: true })
    ]);
    writeManagedOmpProviders.mockImplementationOnce(() => {
      throw new Error('static sync failed');
    });

    expect(() => service.activateStaticOmpChannel('channel-a'))
      .toThrow('static sync failed');

    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));
    expect(saved.channels).toEqual([
      expect.objectContaining({ id: 'channel-a', enabled: false }),
      expect.objectContaining({ id: 'channel-b', enabled: true })
    ]);
  });

  it('synchronizes the single enabled imported channel directly while managed mode is disabled', () => {
    seedChannels([makeChannel('channel-a')]);

    service.syncManagedProviderExtension();

    expect(writeManagedOmpProviders).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'channel-a' })
    ], {});
    expect(removeManagedOmpProviders).not.toHaveBeenCalled();
  });
  it('keeps the persisted gateway secret after managed mode is disabled', () => {
    const first = service.getOrCreateOmpGatewaySecret();
    service.enableManagedOmpMode('channel-a', {
      host: '127.0.0.1',
      port: 20092,
      secret: first
    });
    service.disableManagedOmpMode();

    expect(fs.readFileSync(gatewaySecretPath, 'utf8').trim()).toBe(first);
    expect(fs.statSync(gatewaySecretPath).mode & 0o777).toBe(0o600);

    delete require.cache[OMP_CHANNELS_MODULE];
    injectStubs();
    const reloadedService = require('../../../src/server/services/omp-channels');
    expect(reloadedService.getOrCreateOmpGatewaySecret()).toBe(first);
  });

});

describe('syncCurrentOmpChannel', () => {
  it('imports the current provider selected by config.yml modelRoles.default', () => {
    process.env.OMP_CURRENT_KEY = 'omp-current-key';
    modelsConfig = {
      providers: {
        openai: {
          baseUrl: 'https://omp-current.example/v1',
          apiKey: 'OMP_CURRENT_KEY',
          api: 'openai',
          models: [
            { id: 'gpt-4.1' },
            'gpt-4.1-mini'
          ]
        }
      }
    };
    settingsConfig = {
      modelRoles: {
        default: 'openai/gpt-4.1'
      }
    };

    const result = service.syncCurrentOmpChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.added).toBe(1);
    expect(saved.channels).toHaveLength(1);
    expect(saved.channels[0]).toEqual(expect.objectContaining({
      name: 'openai',
      providerKey: 'openai',
      baseUrl: 'https://omp-current.example/v1',
      apiKey: 'omp-current-key',
      providerApi: 'openai-completions',
      model: 'gpt-4.1',
      allowedModels: ['gpt-4.1']
    }));
  });

  it('imports all providers referenced by enabledModels and modelRoles', () => {
    modelsConfig = {
      providers: {
        deepseek: {
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'deepseek-key',
          api: 'openai-completions',
          models: ['deepseek-v4-flash', 'deepseek-v4-pro']
        },
        nvidia: {
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          apiKey: 'nvidia-key',
          api: 'openai-completions',
          models: [
            'meta/llama-3.1-8b-instruct',
            'z-ai/glm-5.2',
            'minimaxai/minimax-m3'
          ]
        },
        shuaiapi: {
          baseUrl: 'https://api.shuaiapi.com/v1',
          apiKey: 'shuaiapi-key',
          api: 'openai-completions',
          models: ['gpt-5.5', 'gpt-5.6-sol']
        },
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'openai-key',
          api: 'openai-responses',
          models: ['gpt-5.1']
        }
      }
    };
    settingsConfig = {
      enabledModels: [
        'deepseek/deepseek-v4-pro',
        'deepseek/deepseek-v4-flash',
        'nvidia/z-ai/glm-5.2',
        'nvidia/minimaxai/minimax-m3',
        'shuaiapi/gpt-5.5'
      ],
      modelRoles: {
        default: 'shuaiapi/gpt-5.5:high',
        task: 'deepseek/deepseek-v4-pro'
      }
    };

    const result = service.syncCurrentOmpChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));
    const byProvider = Object.fromEntries(saved.channels.map(channel => [channel.providerKey, channel]));

    expect(result.added).toBe(3);
    expect(saved.channels).toHaveLength(3);
    expect(byProvider.openai).toBeUndefined();
    expect(byProvider.deepseek).toEqual(expect.objectContaining({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'deepseek-key',
      model: 'deepseek-v4-pro',
      allowedModels: ['deepseek-v4-pro', 'deepseek-v4-flash']
    }));
    expect(byProvider.nvidia).toEqual(expect.objectContaining({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvidia-key',
      model: 'z-ai/glm-5.2',
      allowedModels: ['z-ai/glm-5.2', 'minimaxai/minimax-m3']
    }));
    expect(byProvider.shuaiapi).toEqual(expect.objectContaining({
      baseUrl: 'https://api.shuaiapi.com/v1',
      apiKey: 'shuaiapi-key',
      model: 'gpt-5.5',
      allowedModels: ['gpt-5.5']
    }));
  });

  it('preserves upstream credentials when syncing a managed provider', () => {
    seedChannels([makeChannel('channel-openai', {
      name: 'OpenAI upstream',
      providerKey: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'real-openai-key',
      model: 'old-model'
    })]);
    modelsConfig = {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'real-openai-key',
          api: 'openai-responses',
          models: ['gpt-4.1']
        },
        'ctx-openai': {
          baseUrl: GENERATED_ROUTE,
          apiKey: GENERATED_KEY,
          api: 'openai-responses',
          models: ['gpt-4.1']
        }
      }
    };
    settingsConfig = {
      modelRoles: {
        default: 'ctx-openai/gpt-4.1'
      }
    };

    const result = service.syncCurrentOmpChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.updated).toBe(1);
    expect(saved.channels).toHaveLength(1);
    expect(saved.channels[0]).toEqual(expect.objectContaining({
      providerKey: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'real-openai-key',
      model: 'gpt-4.1'
    }));
  });

  it('preserves existing credentials when only a generated managed provider remains', () => {
    seedChannels([makeChannel('channel-openai', {
      name: 'OpenAI upstream',
      providerKey: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'real-openai-key',
      model: 'old-model'
    })]);
    modelsConfig = {
      providers: {
        'ctx-openai': {
          baseUrl: GENERATED_ROUTE,
          apiKey: GENERATED_KEY,
          api: 'openai-responses',
          models: ['gpt-4.1']
        }
      }
    };
    settingsConfig = {
      modelRoles: {
        default: 'ctx-openai/gpt-4.1'
      }
    };

    const result = service.syncCurrentOmpChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.updated).toBe(1);
    expect(saved.channels).toHaveLength(1);
    expect(saved.channels[0]).toEqual(expect.objectContaining({
      providerKey: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'real-openai-key',
      model: 'gpt-4.1'
    }));
  });

  it('skips a generated managed provider without an existing upstream channel', () => {
    modelsConfig = {
      providers: {
        'ctx-openai': {
          baseUrl: GENERATED_ROUTE,
          apiKey: GENERATED_KEY,
          api: 'openai-completions',
          models: ['gpt-4.1']
        }
      }
    };
    settingsConfig = {
      modelRoles: {
        default: 'ctx-openai/gpt-4.1'
      }
    };

    const result = service.syncCurrentOmpChannel();

    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings[0]).toContain('Base URL 或 API Key');
    expect(fs.existsSync(channelsPath)).toBe(false);
  });

  it('does not borrow unrelated prefix-matched provider credentials for generated providers', () => {
    seedChannels([makeChannel('channel-openai', {
      name: 'OpenAI upstream',
      providerKey: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'real-openai-key',
      model: 'old-model'
    })]);
    modelsConfig = {
      providers: {
        'openai-compatible': {
          baseUrl: 'https://wrong.example/v1',
          apiKey: 'wrong-key',
          api: 'openai-responses',
          models: ['gpt-4.1']
        },
        'ctx-openai': {
          baseUrl: GENERATED_ROUTE,
          apiKey: GENERATED_KEY,
          api: 'openai-responses',
          models: ['gpt-4.1']
        }
      }
    };
    settingsConfig = {
      modelRoles: {
        default: 'ctx-openai/gpt-4.1'
      }
    };

    const result = service.syncCurrentOmpChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.updated).toBe(1);
    expect(saved.channels[0]).toEqual(expect.objectContaining({
      providerKey: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'real-openai-key'
    }));
  });

  it('preserves no-auth providers when syncing current OMP config', () => {
    modelsConfig = {
      providers: {
        local: {
          baseUrl: 'http://127.0.0.1:11434/v1',
          auth: 'none',
          api: 'openai-completions',
          models: ['llama-local']
        }
      }
    };
    settingsConfig = {
      modelRoles: {
        default: 'local/llama-local'
      }
    };

    const result = service.syncCurrentOmpChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.added).toBe(1);
    expect(saved.channels[0]).toEqual(expect.objectContaining({
      providerKey: 'local',
      baseUrl: 'http://127.0.0.1:11434/v1',
      authMode: 'none',
      apiKey: '',
      model: 'llama-local'
    }));
  });

  it('falls back to OMP api_key credentials stored in agent.db', () => {
    const dbPath = path.join(ompAgentDir, 'agent.db');
    fs.writeFileSync(dbPath, '', 'utf8');
    const binDir = path.join(testDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const sqlitePath = path.join(binDir, 'sqlite3');
    fs.writeFileSync(sqlitePath, [
      '#!/bin/sh',
      'printf \'[{"provider":"deepseek","credential_type":"api_key","data":"{\\\\\\"key\\\\\\":\\\\\\"db-deepseek-key\\\\\\"}"}]\''
    ].join('\n'), 'utf8');
    fs.chmodSync(sqlitePath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${originalPathEnv || ''}`;
    modelsConfig = {
      providers: {
        deepseek: {
          baseUrl: 'https://api.deepseek.com/v1',
          api: 'openai-completions',
          models: ['deepseek-v4-pro']
        }
      }
    };
    settingsConfig = {
      enabledModels: ['deepseek/deepseek-v4-pro']
    };

    const result = service.syncCurrentOmpChannel();
    const saved = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));

    expect(result.added).toBe(1);
    expect(saved.channels[0]).toEqual(expect.objectContaining({
      providerKey: 'deepseek',
      apiKey: 'db-deepseek-key',
      credentialSource: 'omp-auth-db'
    }));
  });

  it('skips providers without a resolvable API key', () => {
    modelsConfig = {
      providers: {
        anthropic: {
          baseUrl: 'https://api.anthropic.com',
          api: 'anthropic',
          models: ['claude-sonnet-4']
        }
      }
    };
    settingsConfig = {
      modelRoles: {
        default: 'anthropic/claude-sonnet-4'
      }
    };

    const result = service.syncCurrentOmpChannel();

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings[0]).toContain('OAuth');
    expect(fs.existsSync(channelsPath)).toBe(false);
  });
});
