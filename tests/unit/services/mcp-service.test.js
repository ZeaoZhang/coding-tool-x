'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { describe, it, expect, beforeEach, afterEach, vi } = globalThis;

// ============================================================================
// Helpers
// ============================================================================

let testDir;
let McpClientMock;
let buildMissingCommandMessageMock;
let createMissingCommandHintMock;
let tomlStringifyMock;
let tomlParseMock;

function setupStubs() {
  // Stub paths config
  const pathsModPath = require.resolve('../../../src/config/paths');
  require.cache[pathsModPath] = {
    id: pathsModPath,
    filename: pathsModPath,
    loaded: true,
    exports: {
      PATHS: {
        mcpServers: path.join(testDir, 'mcp-servers.json'),
        effectiveControlManifest: path.join(testDir, 'effective-control.json')
      },
      NATIVE_PATHS: {
        claude: { settings: path.join(testDir, 'claude-settings.json') },
        codex: { config: path.join(testDir, 'codex-config.toml'), dir: testDir },
        gemini: { env: path.join(testDir, 'gemini', '.env') },
        opencode: { config: testDir },
        omp: {
          dir: path.join(testDir, 'omp-agent'),
          mcp: path.join(testDir, 'omp-agent', 'mcp.json')
        }
      }
    }
  };

  // Stub mcp-client
  const mcpClientPath = require.resolve('../../../src/server/services/mcp-client');
  McpClientMock = vi.fn();
  buildMissingCommandMessageMock = vi.fn(() => 'missing command');
  createMissingCommandHintMock = vi.fn(() => ({ message: 'hint', hints: [] }));
  require.cache[mcpClientPath] = {
    id: mcpClientPath,
    filename: mcpClientPath,
    loaded: true,
    exports: {
      McpClient: McpClientMock,
      buildMissingCommandMessage: buildMissingCommandMessageMock,
      createMissingCommandHint: createMissingCommandHintMock
    }
  };

  // Stub home-dir
  const homeDirPath = require.resolve('../../../src/utils/home-dir');
  require.cache[homeDirPath] = {
    id: homeDirPath,
    filename: homeDirPath,
    loaded: true,
    exports: {
      resolvePreferredHomeDir: () => testDir
    }
  };

  // Stub @iarna/toml
  const tomlPath = require.resolve('@iarna/toml');
  tomlStringifyMock = vi.fn((o) => JSON.stringify(o));
  tomlParseMock = vi.fn((s) => JSON.parse(s));
  require.cache[tomlPath] = {
    id: tomlPath,
    filename: tomlPath,
    loaded: true,
    exports: {
      stringify: tomlStringifyMock,
      parse: tomlParseMock
    }
  };
}

function clearStubs() {
  const toStub = [
    '../../../src/config/paths',
    '../../../src/server/services/mcp-client',
    '../../../src/utils/home-dir',
    '../../../src/server/services/mcp-service'
  ];
  for (const mod of toStub) {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  }
  try {
    delete require.cache[require.resolve('@iarna/toml')];
  } catch (_) {}
}

// ============================================================================
// Tests
// ============================================================================

describe('mcp-service', () => {
  let service;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-service-test-'));
    fs.mkdirSync(path.join(testDir, 'gemini'), { recursive: true });
    setupStubs();
    service = require('../../../src/server/services/mcp-service');
  });

  afterEach(() => {
    clearStubs();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  });

  function stubDynamicMcpRuntime(driver) {
    const runtime = require('../../../src/platforms/runtime');
    const definitions = [
      { key: 'demo-cli', capabilities: { mcp: 'generic-mcp' } },
      { key: 'prompts-only', capabilities: { prompts: 'generic-prompt' } }
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

  // ============================================================================
  // _test.extractMcpHint
  // ============================================================================

  describe('_test.extractMcpHint', () => {
    it('extracts hint from error.data.hint', () => {
      const hint = { title: 'Command not found', details: [] };
      const error = { data: { hint } };
      expect(service._test.extractMcpHint(error)).toEqual(hint);
    });

    it('extracts hint from error.hint when data.hint absent', () => {
      const hint = { title: 'Direct hint' };
      const error = { hint };
      expect(service._test.extractMcpHint(error)).toEqual(hint);
    });

    it('returns null for error without hint', () => {
      expect(service._test.extractMcpHint(new Error('plain error'))).toBeNull();
      expect(service._test.extractMcpHint(null)).toBeNull();
    });
  });

  // ============================================================================
  // _test.buildMcpFailureResult
  // ============================================================================

  describe('_test.buildMcpFailureResult', () => {
    it('uses hint title when hint present', () => {
      const error = { data: { hint: { title: 'Hint title', details: [] } } };
      const result = service._test.buildMcpFailureResult(error, 'fallback', 100);
      expect(result.message).toBe('Hint title');
      expect(result.hint).toBeDefined();
      expect(result.duration).toBe(100);
    });

    it('uses fallbackMessage when no hint', () => {
      const error = new Error('raw error');
      const result = service._test.buildMcpFailureResult(error, 'fallback message', 200);
      expect(result.message).toBe('fallback message');
      expect(result.hint).toBeNull();
    });

    it('includes duration in result', () => {
      const result = service._test.buildMcpFailureResult(null, 'msg', 42);
      expect(result.duration).toBe(42);
    });
  });

  // ============================================================================
  // getPresets
  // ============================================================================

  describe('getPresets', () => {
    it('returns an array', () => {
      const presets = service.getPresets();
      expect(Array.isArray(presets)).toBe(true);
    });

    it('each preset has id, name, and server fields', () => {
      const presets = service.getPresets();
      expect(presets.length).toBeGreaterThan(0);
      for (const preset of presets) {
        expect(preset).toHaveProperty('id');
        expect(preset).toHaveProperty('name');
        expect(preset).toHaveProperty('server');
      }
    });

    it('includes a fetch preset', () => {
      const presets = service.getPresets();
      const fetchPreset = presets.find(p => p.id === 'fetch');
      expect(fetchPreset).toBeDefined();
      expect(fetchPreset.server.command).toBe('uvx');
    });
  });

  // ============================================================================
  // validateServerSpec
  // ============================================================================

  describe('validateServerSpec', () => {
    it('accepts valid stdio spec', () => {
      expect(() => service.validateServerSpec({ type: 'stdio', command: 'npx' })).not.toThrow();
    });

    it('accepts valid sse spec', () => {
      expect(() => service.validateServerSpec({ type: 'sse', url: 'http://localhost:3000' })).not.toThrow();
    });

    it('accepts valid streamable_http spec', () => {
      expect(() => service.validateServerSpec({ type: 'streamable_http', url: 'http://localhost:8000/mcp' })).not.toThrow();
    });

    it('rejects http because streamable_http is the only HTTP MCP transport type', () => {
      expect(() => service.validateServerSpec({ type: 'http', url: 'http://localhost:8000/mcp' })).toThrow(/无效的服务器类型/);
    });

    it('throws when name/spec is missing (null)', () => {
      expect(() => service.validateServerSpec(null)).toThrow();
    });

    it('throws when type is missing (defaults to stdio) but command absent', () => {
      expect(() => service.validateServerSpec({ command: '' })).toThrow();
    });

    it('throws for invalid type', () => {
      expect(() => service.validateServerSpec({ type: 'grpc', command: 'something' })).toThrow(/无效的服务器类型/);
    });

    it('throws for stdio without command', () => {
      expect(() => service.validateServerSpec({ type: 'stdio', command: '' })).toThrow(/command/);
    });
  });

  // ============================================================================
  // getAllServers
  // ============================================================================

  describe('getAllServers', () => {
    it('returns empty object when file does not exist', () => {
      const result = service.getAllServers();
      expect(result).toEqual({});
    });

    it('keeps legacy Claude default for missing apps while preserving hidden historical flags', async () => {
      const mcpFile = path.join(testDir, 'mcp-servers.json');
      const data = {
        'legacy-server': {
          id: 'legacy-server',
          name: 'Legacy Server',
          server: { type: 'stdio', command: 'npx' }
        },
        'hidden-server': {
          id: 'hidden-server',
          name: 'Hidden Server',
          server: { type: 'stdio', command: 'npx' },
          apps: { claude: false, 'hidden-cli': true }
        }
      };
      fs.writeFileSync(mcpFile, JSON.stringify(data), 'utf-8');

      const result = service.getAllServers();

      expect(result['legacy-server'].apps.claude).toBe(true);
      expect(result['legacy-server'].apps.codex).toBe(false);
      expect(result['hidden-server'].apps.claude).toBe(false);
      expect(result['hidden-server'].apps['hidden-cli']).toBe(true);

      const saved = await service.saveServer({
        id: 'legacy-server',
        name: 'Legacy Server Updated',
        server: { type: 'stdio', command: 'npx' }
      }, { syncPlatforms: false });

      expect(saved.apps.claude).toBe(true);
      expect(saved.apps.codex).toBe(false);
      expect(saved.name).toBe('Legacy Server Updated');
    });

    it('returns parsed servers when file exists', () => {
      const mcpFile = path.join(testDir, 'mcp-servers.json');
      const data = {
        'my-server': {
          id: 'my-server',
          name: 'My Server',
          server: { type: 'stdio', command: 'npx' },
          apps: { claude: true, codex: false, gemini: false, opencode: false }
        }
      };
      fs.writeFileSync(mcpFile, JSON.stringify(data), 'utf-8');
      const result = service.getAllServers();
      expect(result['my-server']).toBeDefined();
      expect(result['my-server'].name).toBe('My Server');
    });

    it('registers existing native-only MCP as external without catalog ownership', () => {
      fs.writeFileSync(path.join(testDir, '.claude.json'), JSON.stringify({
        mcpServers: { native: { type: 'stdio', command: 'node' } }
      }), 'utf8');

      const result = service.getAllServers();
      const manifest = JSON.parse(fs.readFileSync(path.join(testDir, 'effective-control.json'), 'utf8'));

      expect(result.native).toBeUndefined();
      expect(manifest.mcp['mcp:claude:user:native']).toEqual(expect.objectContaining({
        managed: false,
        source: 'native'
      }));
    });

    it('returns empty object on invalid JSON', () => {
      const mcpFile = path.join(testDir, 'mcp-servers.json');
      fs.writeFileSync(mcpFile, 'not valid json', 'utf-8');
      const result = service.getAllServers();
      expect(result).toEqual({});
    });
  });

  // ============================================================================
  // getServer
  // ============================================================================

  describe('getServer', () => {
    it('returns server by id when it exists', () => {
      const mcpFile = path.join(testDir, 'mcp-servers.json');
      const data = {
        'srv-1': {
          id: 'srv-1',
          name: 'Server One',
          server: { type: 'stdio', command: 'uvx' },
          apps: {}
        }
      };
      fs.writeFileSync(mcpFile, JSON.stringify(data), 'utf-8');
      const result = service.getServer('srv-1');
      expect(result).toBeDefined();
      expect(result.name).toBe('Server One');
    });

    it('returns null for non-existing id', () => {
      const result = service.getServer('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('server persistence and export helpers', () => {
    it('saveServer assigns default apps for a new server when apps are omitted', async () => {
      const saved = await service.saveServer({
        id: 'srv-default',
        name: 'Default Server',
        server: { type: 'stdio', command: 'uvx' }
      }, { syncPlatforms: false });

      expect(saved.apps).toEqual({
        claude: true,
        codex: false,
        gemini: false,
        opencode: false,
        omp: false
      });
      expect(service.getServer('srv-default').createdAt).toBeDefined();
    });

    it('saveServer preserves historical hidden app flags when updating apps', async () => {
      const first = await service.saveServer({
        id: 'srv-hidden-apps',
        name: 'Hidden Apps',
        server: { type: 'stdio', command: 'uvx' },
        apps: { claude: true, 'hidden-cli': true }
      }, { syncPlatforms: false });

      const updated = await service.saveServer({
        id: 'srv-hidden-apps',
        name: 'Hidden Apps Updated',
        server: { type: 'stdio', command: 'uvx' },
        apps: { claude: false }
      }, { syncPlatforms: false });

      expect(updated.createdAt).toBe(first.createdAt);
      expect(updated.apps.claude).toBe(false);
      expect(updated.apps['hidden-cli']).toBe(true);
      expect(service.getServer('srv-hidden-apps').apps['hidden-cli']).toBe(true);
    });

    it('preserves omitted and redacted secret fields when updating a server spec', async () => {
      await service.saveServer({
        id: 'srv-keep-secrets',
        name: 'Keep Secrets',
        server: {
          type: 'stdio',
          command: 'uvx',
          env: { TOKEN: 'secret-value' },
          headers: { Authorization: 'Bearer secret-value' }
        }
      }, { syncPlatforms: false });

      await service.saveServer({
        id: 'srv-keep-secrets',
        name: 'Keep Secrets Updated',
        server: { type: 'stdio', command: 'uvx-new', env: { TOKEN: '[REDACTED]' } }
      }, { syncPlatforms: false });

      expect(service.getServer('srv-keep-secrets').server).toEqual(expect.objectContaining({
        command: 'uvx-new',
        env: { TOKEN: 'secret-value' },
        headers: { Authorization: 'Bearer secret-value' }
      }));
    });

    it('deleteServer removes existing server and returns true', async () => {
      await service.saveServer({
        id: 'srv-delete',
        name: 'To Delete',
        server: { type: 'stdio', command: 'uvx' }
      }, { syncPlatforms: false });

      const result = await service.deleteServer('srv-delete');

      expect(result).toBe(true);
      expect(service.getServer('srv-delete')).toBeNull();
    });

    it('toggleServerApp updates a platform flag', async () => {
      await service.saveServer({
        id: 'srv-toggle',
        name: 'Toggle Server',
        server: { type: 'stdio', command: 'uvx' }
      }, { syncPlatforms: false });

      const updated = await service.toggleServerApp('srv-toggle', 'opencode', true);

      expect(updated.apps.opencode).toBe(true);
      expect(service.getServer('srv-toggle').apps.opencode).toBe(true);
    });

    it('toggleServerApp rejects invalid platforms', async () => {
      await service.saveServer({
        id: 'srv-invalid',
        name: 'Invalid Server',
        server: { type: 'stdio', command: 'uvx' }
      }, { syncPlatforms: false });

      await expect(service.toggleServerApp('srv-invalid', 'invalid-app', true)).rejects.toThrow(/无效的平台/);
    });

    it('getStats counts enabled platforms across servers', async () => {
      await service.saveServer({
        id: 'srv-stats-1',
        name: 'Claude Only',
        server: { type: 'stdio', command: 'uvx' },
        apps: { claude: true }
      }, { syncPlatforms: false });
      await service.saveServer({
        id: 'srv-stats-2',
        name: 'Codex + Gemini',
        server: { type: 'stdio', command: 'npx' },
        apps: { claude: false, codex: true, gemini: true, opencode: false }
      }, { syncPlatforms: false });

      expect(service.getStats()).toEqual({
        total: 2,
        claude: 1,
        codex: 1,
        gemini: 1,
        opencode: 0,
        omp: 0
      });
    });

    it('updateServerStatus records status and lastChecked timestamp', async () => {
      await service.saveServer({
        id: 'srv-status',
        name: 'Status Server',
        server: { type: 'stdio', command: 'uvx' }
      }, { syncPlatforms: false });

      const updated = await service.updateServerStatus('srv-status', 'online');

      expect(updated.status).toBe('online');
      expect(updated.lastChecked).toBeTypeOf('number');
    });

    it('updateServerOrder stores order indexes', async () => {
      await service.saveServer({
        id: 'srv-order-a',
        name: 'A',
        server: { type: 'stdio', command: 'uvx' }
      }, { syncPlatforms: false });
      await service.saveServer({
        id: 'srv-order-b',
        name: 'B',
        server: { type: 'stdio', command: 'npx' }
      }, { syncPlatforms: false });

      const result = service.updateServerOrder(['srv-order-b', 'srv-order-a']);

      expect(result['srv-order-b'].order).toBe(0);
      expect(result['srv-order-a'].order).toBe(1);
    });

    it('rejects prototype-polluting IDs while reordering servers', () => {
      expect(() => service.updateServerOrder(['__proto__'])).toThrow(/MCP server ID|invalid/i);
    });

    it('exportServers filters by format app flags', async () => {
      await service.saveServer({
        id: 'srv-export-a',
        name: 'Claude',
        server: { type: 'stdio', command: 'uvx', args: ['fetch'] },
        apps: { claude: true, codex: false, gemini: false, opencode: false }
      }, { syncPlatforms: false });
      await service.saveServer({
        id: 'srv-export-b',
        name: 'Codex',
        server: { type: 'stdio', command: 'npx', args: ['time'] },
        apps: { claude: false, codex: true, gemini: false, opencode: false }
      }, { syncPlatforms: false });

      const claudeExport = service.exportServers('claude');
      const jsonExport = service.exportServers('json');

      expect(claudeExport.format).toBe('claude');
      expect(claudeExport.content).toContain('srv-export-a');
      expect(claudeExport.content).not.toContain('srv-export-b');
      expect(jsonExport.filename).toBe('mcp-servers.json');
      expect(jsonExport.content).toContain('srv-export-a');
      expect(jsonExport.content).toContain('srv-export-b');
    });

    it('redacts secrets from explicit MCP exports', async () => {
      await service.saveServer({
        id: 'srv-export-secrets',
        name: 'Secrets',
        server: {
          type: 'streamable_http',
          url: 'https://user:password@example.com/mcp?token=query-secret',
          args: ['--token', 'argument-secret'],
          headers: { Authorization: 'Bearer secret-value' },
          env_vars: { API_TOKEN: 'actual-token' },
          environment: { API_KEY: 'actual-key' },
          bearer_token_env_var: 'MCP_TOKEN',
          auth: 'auth-secret',
          apiKey: 'api-secret',
          oauth: { access_token: 'access-secret' }
        },
        apps: { claude: true }
      }, { syncPlatforms: false });

      const exported = service.exportServers('json');

      expect(exported.content).not.toContain('password@example.com');
      expect(exported.content).not.toContain('secret-value');
      expect(exported.content).not.toContain('actual-token');
      expect(exported.content).not.toContain('actual-key');
      expect(exported.content).not.toContain('oauth-secret');
      expect(exported.content).not.toContain('argument-secret');
      expect(exported.content).not.toContain('auth-secret');
      expect(exported.content).not.toContain('api-secret');
      expect(exported.content).not.toContain('access-secret');
      expect(exported.content).toContain('[REDACTED]');
    });

    it('exports remote servers as streamable_http', async () => {
      await service.saveServer({
        id: 'srv-streamable-export',
        name: 'Remote',
        server: { type: 'streamable_http', url: 'https://example.com/mcp' },
        apps: { claude: true, codex: true, gemini: true, opencode: false }
      }, { syncPlatforms: false });

      const claudeExport = service.exportServers('claude');
      const codexExport = service.exportServers('codex');
      const geminiExport = service.exportServers('gemini');

      expect(claudeExport.content).toContain('"type": "streamable_http"');
      expect(codexExport.content).toContain('"type":"streamable_http"');
      expect(geminiExport.content).toContain('"type": "streamable_http"');
    });

    it('syncs enabled servers to OMP mcp.json and preserves unrelated OMP settings', async () => {
      const ompMcpPath = path.join(testDir, 'omp-agent', 'mcp.json');
      fs.mkdirSync(path.dirname(ompMcpPath), { recursive: true });
      fs.writeFileSync(ompMcpPath, JSON.stringify({
        $schema: 'existing-schema',
        disabledServers: ['old-disabled'],
        mcpServers: {
          existing: { type: 'stdio', command: 'old' }
        }
      }), 'utf8');

      await service.saveServer({
        id: 'srv_omp',
        name: 'OMP Server',
        server: {
          type: 'streamable_http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' }
        },
        apps: { claude: false, omp: true }
      });

      const ompConfig = JSON.parse(fs.readFileSync(ompMcpPath, 'utf8'));
      expect(ompConfig.$schema).toBe('existing-schema');
      expect(ompConfig.disabledServers).toEqual(['old-disabled']);
      expect(ompConfig.mcpServers.existing).toEqual({ type: 'stdio', command: 'old' });
      expect(ompConfig.mcpServers.srv_omp).toEqual({
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' }
      });
    });

    it('toggleServerApp supports OMP and removes only the managed server entry', async () => {
      const ompMcpPath = path.join(testDir, 'omp-agent', 'mcp.json');
      await service.saveServer({
        id: 'srv-omp-toggle',
        name: 'OMP Toggle',
        server: { type: 'stdio', command: 'uvx' },
        apps: { claude: false, omp: true }
      });

      await service.toggleServerApp('srv-omp-toggle', 'omp', false);

      const stored = service.getServer('srv-omp-toggle');
      const ompConfig = JSON.parse(fs.readFileSync(ompMcpPath, 'utf8'));
      expect(stored.apps.omp).toBe(false);
      expect(ompConfig.mcpServers['srv-omp-toggle']).toBeUndefined();
    });

    it('imports OMP http servers as internal streamable_http servers', async () => {
      const ompMcpPath = path.join(testDir, 'omp-agent', 'mcp.json');
      fs.mkdirSync(path.dirname(ompMcpPath), { recursive: true });
      fs.writeFileSync(ompMcpPath, JSON.stringify({
        mcpServers: {
          remote: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { 'X-Test': '1' }
          }
        }
      }), 'utf8');

      const count = await service.importFromPlatform('omp');
      const imported = service.getServer('remote');

      expect(count).toBe(1);
      expect(imported.apps.omp).toBe(true);
      expect(imported.server).toEqual({
        type: 'streamable_http',
        url: 'https://example.com/mcp',
        headers: { 'X-Test': '1' }
      });
    });

    it('exports OMP format with http transport mapping', async () => {
      await service.saveServer({
        id: 'srv-omp-export',
        name: 'OMP Export',
        server: { type: 'streamable_http', url: 'https://example.com/mcp' },
        apps: { claude: false, omp: true }
      }, { syncPlatforms: false });

      const exported = service.exportServers('omp');
      const content = JSON.parse(exported.content);

      expect(exported.format).toBe('omp');
      expect(exported.filename).toBe('omp-mcp-config.json');
      expect(content.mcpServers['srv-omp-export']).toEqual({
        type: 'http',
        url: 'https://example.com/mcp'
      });
    });
  });

  describe('legacy platform file adapters', () => {
    it('round-trips native MCP config formats through fixed platform adapters', () => {
      const configs = {
        claude: { mcpServers: { claude: { command: 'claude-mcp' } } },
        codex: { mcp_servers: { codex: { command: 'codex-mcp' } } },
        gemini: { mcpServers: { gemini: { command: 'gemini-mcp' } } },
        opencode: { mcp: { opencode: { command: 'opencode-mcp' } } },
        omp: { mcpServers: { omp: { command: 'omp-mcp' } } }
      };

      for (const [platform, config] of Object.entries(configs)) {
        service.writePlatformMcpConfig(platform, config);
        expect(service.readPlatformMcpConfig(platform)).toEqual(config);
      }
    });

    it('removes one server through the fixed native adapter', () => {
      service.writePlatformMcpConfig('claude', {
        mcpServers: {
          keep: { command: 'keep' },
          remove: { command: 'remove' }
        }
      });

      service.removePlatformMcpServer('claude', 'remove');

      expect(service.readPlatformMcpConfig('claude')).toEqual({
        mcpServers: { keep: { command: 'keep' } }
      });
    });
  });

  describe('registry-driven MCP platforms', () => {
    it('syncs and counts a generic MCP platform without a service switch', async () => {
      let config = { mcpServers: {} };
      const driver = {
        read: vi.fn(async () => config),
        write: vi.fn(async next => {
          config = next;
          return { status: 'ok', capability: 'mcp', operation: 'write' };
        })
      };
      const restore = stubDynamicMcpRuntime(driver);

      try {
        await service.saveServer({
          id: 'demo-server',
          name: 'Demo server',
          server: { type: 'stdio', command: 'demo-mcp', args: ['--stdio'] },
          apps: { 'demo-cli': true }
        });

        expect(config.mcpServers['demo-server']).toEqual({
          type: 'stdio',
          command: 'demo-mcp',
          args: ['--stdio']
        });
        expect(service.getStats()).toEqual({ total: 1, 'demo-cli': 1 });

        await service.toggleServerApp('demo-server', 'demo-cli', false);
        expect(config.mcpServers).toEqual({});
      } finally {
        restore();
      }
    });
    it('syncs registry MCP platforms even when enabledOnly filters them from UI selection', async () => {
      const driver = {
        read: vi.fn(async () => ({ mcpServers: {} })),
        write: vi.fn(async next => next)
      };
      const runtime = require('../../../src/platforms/runtime');
      const definitions = [
        { key: 'visible-cli', capabilities: { mcp: 'generic-mcp' } },
        { key: 'hidden-cli', capabilities: { mcp: 'generic-mcp' } }
      ];
      const byKey = new Map(definitions.map(definition => [definition.key, definition]));
      const registry = {
        list: vi.fn((options = {}) => (options.enabledOnly ? definitions.filter(definition => definition.key === 'visible-cli') : definitions)),
        resolve: key => byKey.get(String(key).trim().toLowerCase()) || null,
        getCapability: (key, capability) => byKey.get(String(key).trim().toLowerCase())?.capabilities?.[capability] || null
      };
      const registrySpy = vi.spyOn(runtime, 'getPlatformRegistry').mockReturnValue(registry);
      const runtimeSpy = vi.spyOn(runtime, 'getPlatformRuntime').mockReturnValue({ getDriver: vi.fn(() => driver) });

      try {
        await service.saveServer({
          id: 'hidden-demo',
          name: 'Hidden demo',
          server: { type: 'stdio', command: 'hidden-mcp' },
          apps: { 'hidden-cli': true }
        });

        expect(driver.write).toHaveBeenCalledTimes(1);
        expect(service.getStats()).toEqual({
          total: 1,
          'visible-cli': 0,
          'hidden-cli': 1
        });
      } finally {
        registrySpy.mockRestore();
        runtimeSpy.mockRestore();
      }
    });

    it('imports a generic MCP mapping and enables only its registry platform', async () => {
      const config = {
        mcpServers: {
          imported: { type: 'stdio', command: 'imported-mcp' }
        }
      };
      const driver = {
        read: vi.fn(async () => config),
        write: vi.fn(async () => ({ status: 'ok', capability: 'mcp', operation: 'write' }))
      };
      const restore = stubDynamicMcpRuntime(driver);

      try {
        fs.writeFileSync(path.join(testDir, 'mcp-servers.json'), '{}', 'utf8');
        const count = await service.importFromPlatform('demo-cli');
        const imported = service.getServer('imported');

        expect(count).toBe(1);
        expect(imported.apps).toEqual({ 'demo-cli': true });
        expect(imported.server).toEqual({
          type: 'stdio',
          command: 'imported-mcp'
        });
      } finally {
        restore();
      }
    });

    it('distinguishes unknown platforms from platforms without MCP capability', async () => {
      const restore = stubDynamicMcpRuntime({
        read: vi.fn(async () => ({ mcpServers: {} })),
        write: vi.fn(async () => ({ status: 'ok', capability: 'mcp', operation: 'write' }))
      });

      try {
        await service.saveServer({
          id: 'capability-errors',
          name: 'Capability errors',
          server: { type: 'stdio', command: 'demo-mcp' }
        }, { syncPlatforms: false });

        await expect(service.toggleServerApp('capability-errors', 'missing-cli', true))
          .rejects.toMatchObject({ status: 404, code: 'not_found', platform: 'missing-cli', capability: 'mcp' });
        await expect(service.toggleServerApp('capability-errors', 'prompts-only', true))
          .rejects.toMatchObject({ status: 404, code: 'unsupported', platform: 'prompts-only', capability: 'mcp' });
      } finally {
        restore();
      }
    });
  });

  describe('MCP client interactions', () => {
    beforeEach(async () => {
      await service.saveServer({
        id: 'srv-tools',
        name: 'Tools Server',
        server: { type: 'stdio', command: 'uvx' }
      }, { syncPlatforms: false });
    });

    it('getServerTools connects, initializes, and lists tools', async () => {
      const client = {
        connected: false,
        connect: vi.fn(async () => { client.connected = true; }),
        initialize: vi.fn(async () => {}),
        listTools: vi.fn(async () => [{ name: 'fetch' }]),
        disconnect: vi.fn(async () => {})
      };
      McpClientMock.mockImplementation(function MockClient() { return client; });

      const result = await service.getServerTools('srv-tools');

      expect(result.status).toBe('online');
      expect(result.tools).toEqual([{ name: 'fetch' }]);
      expect(client.connect).toHaveBeenCalled();
      expect(client.initialize).toHaveBeenCalled();
    });

    it('redacts sensitive fields in MCP tool definitions', async () => {
      const client = {
        connected: false,
        connect: vi.fn(async () => { client.connected = true; }),
        initialize: vi.fn(async () => {}),
        listTools: vi.fn(async () => [{
          name: 'fetch',
          description: 'Bearer tool-secret https://example.com/mcp?token=query-secret',
          inputSchema: {
            properties: {
              token: { default: 'schema-secret' }
            }
          }
        }]),
        disconnect: vi.fn(async () => {})
      };
      McpClientMock.mockImplementation(function MockClient() { return client; });

      const result = await service.getServerTools('srv-tools');

      expect(result.tools[0].description).not.toContain('tool-secret');
      expect(result.tools[0].inputSchema.properties.token).toBe('[REDACTED]');
    });

    it('testServer performs the same MCP handshake for streamable_http servers', async () => {
      await service.saveServer({
        id: 'srv-streamable-http',
        name: 'Streamable HTTP Server',
        server: { type: 'streamable_http', url: 'http://127.0.0.1:8000/mcp' }
      }, { syncPlatforms: false });

      const client = {
        connected: false,
        connect: vi.fn(async () => { client.connected = true; }),
        initialize: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {})
      };
      McpClientMock.mockImplementation(function MockClient() { return client; });

      const result = await service.testServer('srv-streamable-http');

      expect(result.success).toBe(true);
      expect(result.message).toBe('服务器 MCP 握手成功');
      expect(client.connect).toHaveBeenCalled();
      expect(client.initialize).toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('refuses connection tests when the effective control disables the server', async () => {
      await service.toggleServerApp('srv-tools', 'claude', false);

      await expect(service.testServer('srv-tools')).rejects.toMatchObject({ code: 'MCP_DISABLED' });
      expect(McpClientMock).not.toHaveBeenCalled();
    });

    it('callServerTool truncates oversized results', async () => {
      const client = {
        connected: false,
        connect: vi.fn(async () => { client.connected = true; }),
        initialize: vi.fn(async () => {}),
        callTool: vi.fn(async () => ({ payload: 'x'.repeat(11 * 1024) })),
        disconnect: vi.fn(async () => {})
      };
      McpClientMock.mockImplementation(function MockClient() { return client; });

      const result = await service.callServerTool('srv-tools', 'fetch', { url: 'https://example.com' });

      expect(result.isError).toBe(false);
      expect(result.result.truncated).toBe(true);
      expect(result.truncatedSize).toBeGreaterThan(10 * 1024);
    });

    it('redacts protocol error results returned by MCP tools', async () => {
      const client = {
        connected: false,
        connect: vi.fn(async () => { client.connected = true; }),
        initialize: vi.fn(async () => {}),
        callTool: vi.fn(async () => ({
          isError: true,
          content: [{
            type: 'text',
            text: 'Bearer top-secret https://example.com/mcp?token=query-secret'
          }],
          credentials: { token: 'nested-secret' }
        })),
        disconnect: vi.fn(async () => {})
      };
      McpClientMock.mockImplementation(function MockClient() { return client; });

      const result = await service.callServerTool('srv-tools', 'fetch', {});

      expect(result.isError).toBe(true);
      expect(result.result.credentials).toBe('[REDACTED]');
      expect(result.result.content[0].text).not.toContain('top-secret');
      expect(result.result.content[0].text).not.toContain('query-secret');
    });

    it('refuses tool access when every controlled platform is disabled', async () => {
      await service.toggleServerApp('srv-tools', 'claude', false);

      await expect(service.getServerTools('srv-tools')).rejects.toMatchObject({ code: 'MCP_DISABLED' });
      await expect(service.callServerTool('srv-tools', 'fetch', {})).rejects.toMatchObject({ code: 'MCP_DISABLED' });
    });
  it('rejects unsafe IDs and non-string transport fields', async () => {
    await expect(service.saveServer({
      id: '__proto__',
      server: { type: 'stdio', command: 'node' }
    }, { syncPlatforms: false })).rejects.toThrow(/ID|invalid|prototype/i);
    expect(() => service.validateServerSpec({ type: 'stdio', command: 42 })).toThrow(/string|command/i);
    expect(() => service.validateServerSpec({ type: 'sse', url: 42 })).toThrow(/string|url/i);
  });

  it('uses the effective control manifest as the MCP activation authority', async () => {
    await service.saveServer({
      id: 'control-server',
      name: 'Control Server',
      server: { type: 'stdio', command: 'node' },
      apps: { claude: true }
    }, { syncPlatforms: false });

    const manifestPath = path.join(testDir, 'effective-control.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.mcp['mcp:claude:user:control-server'].enabled).toBe(true);

    await service.toggleServerApp('control-server', 'claude', false);
    expect(service.getServer('control-server').apps.claude).toBe(false);
    const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(updated.mcp['mcp:claude:user:control-server'].enabled).toBe(false);
  });

  it('applies persisted MCP app changes through the effective control', async () => {
    await service.saveServer({
      id: 'save-toggle',
      name: 'Save Toggle',
      server: { type: 'stdio', command: 'node' },
      apps: { claude: true }
    }, { syncPlatforms: false });

    await service.saveServer({
      id: 'save-toggle',
      name: 'Save Toggle',
      server: { type: 'stdio', command: 'node' },
      apps: { claude: false }
    }, { syncPlatforms: false });

    expect(service.getServer('save-toggle').apps.claude).toBe(false);
  });

  it('does not sync native MCP files for a blocked control entry', async () => {
    await service.saveServer({
      id: 'blocked-sync',
      name: 'Blocked Sync',
      server: { type: 'stdio', command: 'node' },
      apps: { claude: false }
    }, { syncPlatforms: false });
    const manifestPath = path.join(testDir, 'effective-control.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.mcp['mcp:claude:user:blocked-sync'].trust = 'blocked';
    manifest.mcp['mcp:claude:user:blocked-sync'].enabled = false;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    await service.saveServer({
      id: 'blocked-sync',
      name: 'Blocked Sync',
      server: { type: 'stdio', command: 'node' },
      apps: { claude: true }
    });

    expect(service.getServer('blocked-sync').apps.claude).toBe(false);
  });
  });
});
