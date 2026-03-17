const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let configTemplatesService;
let channelsService;
let codexChannelsService;
let geminiChannelsService;
let opencodeChannelsService;
let AgentsServiceStub;
let CommandsServiceStub;
let SkillServiceStub;
let workspaceService;
let favoritesService;
let mcpService;
let promptsService;
let loadConfigMock;
let saveConfigMock;
let loadUIConfigMock;
let saveUIConfigMock;
let admZipInstances;

function stubModules() {
  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        base: testDir,
        uiConfig: path.join(testDir, 'store', 'ui-config.json'),
        prompts: path.join(testDir, 'store', 'prompts.json'),
        security: path.join(testDir, 'store', 'security.json'),
        oauthCredentials: path.join(testDir, 'store', 'oauth.json')
      },
      NATIVE_PATHS: {
        claude: { settings: path.join(testDir, '.claude', 'settings.json') },
        codex: { config: path.join(testDir, '.codex', 'config.toml'), auth: path.join(testDir, '.codex', 'auth.json') },
        gemini: { env: path.join(testDir, '.gemini', '.env') },
        opencode: { config: path.join(testDir, '.opencode') }
      }
    }
  };

  configTemplatesService = {
    getAllTemplates: vi.fn(() => [
      { id: 'builtin', name: 'Builtin', isBuiltin: true },
      { id: 'custom', name: 'Custom', isBuiltin: false }
    ]),
    getTemplateById: vi.fn(() => null),
    createCustomTemplate: vi.fn(),
    updateCustomTemplate: vi.fn()
  };
  channelsService = {
    getAllChannels: vi.fn(() => [{ id: 'claude-1', name: 'Claude', baseUrl: 'https://claude.example', apiKey: 'key', enabled: true }]),
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
    applyChannelToSettings: vi.fn()
  };
  codexChannelsService = {
    getChannels: vi.fn(() => ({ channels: [] })),
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
    writeCodexConfigForMultiChannel: vi.fn()
  };
  geminiChannelsService = {
    getChannels: vi.fn(() => ({ channels: [{ id: 'gemini-1', name: 'Gemini', baseUrl: 'https://gemini.example', enabled: true }] })),
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
    applyChannelToSettings: vi.fn()
  };
  opencodeChannelsService = {
    getChannels: vi.fn(() => ({ channels: [{ id: 'opencode-1', name: 'OpenCode', baseUrl: 'https://opencode.example', providerKey: 'openai', enabled: true }] })),
    createChannel: vi.fn(),
    updateChannel: vi.fn()
  };

  class AgentsServiceFake {
    constructor(platform) {
      this.platform = platform;
      this.userAgentsDir = path.join(testDir, 'agents-install', platform);
    }
    listAgents() {
      return {
        agents: [{
          fileName: `${this.platform}-agent`,
          name: `${this.platform} agent`,
          description: 'agent desc',
          path: `${this.platform}-agent.md`,
          fullContent: '---\nname: agent\n---\nbody',
          systemPrompt: 'body'
        }]
      };
    }
  }
  AgentsServiceStub = AgentsServiceFake;

  class CommandsServiceFake {
    constructor(platform) {
      this.platform = platform;
      this.userCommandsDir = path.join(testDir, 'commands-install', platform);
    }
    listCommands() {
      return {
        commands: [{
          name: `${this.platform}-command`,
          path: `${this.platform}-command.md`,
          description: 'command desc',
          body: 'command body',
          fullContent: '---\ndescription: "command desc"\n---\ncommand body'
        }]
      };
    }
  }
  CommandsServiceStub = CommandsServiceFake;

  class SkillServiceFake {
    constructor(platform) {
      this.platform = platform;
      this.installDir = path.join(testDir, 'skills-install', platform);
      fs.mkdirSync(this.installDir, { recursive: true });
    }
    getInstalledSkills() {
      return [{
        directory: `${this.platform}-skill`,
        name: `${this.platform} skill`,
        description: 'skill desc'
      }];
    }
  }
  SkillServiceStub = SkillServiceFake;

  workspaceService = {
    loadWorkspaces: vi.fn(() => ({ workspaces: [{ id: 'ws-1', name: 'Workspace 1' }] })),
    saveWorkspaces: vi.fn()
  };
  favoritesService = {
    loadFavorites: vi.fn(() => ({ favoriteProjects: ['demo'] })),
    saveFavorites: vi.fn()
  };
  mcpService = {
    getAllServers: vi.fn(() => ({ fetch: { id: 'fetch', name: 'Fetch' } })),
    saveServer: vi.fn(async () => {})
  };
  promptsService = {
    activatePreset: vi.fn(async () => {}),
    deactivatePrompt: vi.fn(async () => {})
  };
  loadConfigMock = vi.fn(() => ({ ports: { webUI: 19999 } }));
  saveConfigMock = vi.fn();
  loadUIConfigMock = vi.fn(() => ({ theme: 'light' }));
  saveUIConfigMock = vi.fn();

  require.cache[require.resolve('../../../src/server/services/config-templates-service')] = {
    id: require.resolve('../../../src/server/services/config-templates-service'),
    filename: require.resolve('../../../src/server/services/config-templates-service'),
    loaded: true,
    exports: configTemplatesService
  };
  require.cache[require.resolve('../../../src/server/services/channels')] = {
    id: require.resolve('../../../src/server/services/channels'),
    filename: require.resolve('../../../src/server/services/channels'),
    loaded: true,
    exports: channelsService
  };
  require.cache[require.resolve('../../../src/server/services/codex-channels')] = {
    id: require.resolve('../../../src/server/services/codex-channels'),
    filename: require.resolve('../../../src/server/services/codex-channels'),
    loaded: true,
    exports: codexChannelsService
  };
  require.cache[require.resolve('../../../src/server/services/gemini-channels')] = {
    id: require.resolve('../../../src/server/services/gemini-channels'),
    filename: require.resolve('../../../src/server/services/gemini-channels'),
    loaded: true,
    exports: geminiChannelsService
  };
  require.cache[require.resolve('../../../src/server/services/opencode-channels')] = {
    id: require.resolve('../../../src/server/services/opencode-channels'),
    filename: require.resolve('../../../src/server/services/opencode-channels'),
    loaded: true,
    exports: opencodeChannelsService
  };
  require.cache[require.resolve('../../../src/server/services/agents-service')] = {
    id: require.resolve('../../../src/server/services/agents-service'),
    filename: require.resolve('../../../src/server/services/agents-service'),
    loaded: true,
    exports: { AgentsService: AgentsServiceStub }
  };
  require.cache[require.resolve('../../../src/server/services/commands-service')] = {
    id: require.resolve('../../../src/server/services/commands-service'),
    filename: require.resolve('../../../src/server/services/commands-service'),
    loaded: true,
    exports: { CommandsService: CommandsServiceStub }
  };
  require.cache[require.resolve('../../../src/server/services/skill-service')] = {
    id: require.resolve('../../../src/server/services/skill-service'),
    filename: require.resolve('../../../src/server/services/skill-service'),
    loaded: true,
    exports: { SkillService: SkillServiceStub }
  };
  require.cache[require.resolve('../../../src/server/services/workspace-service')] = {
    id: require.resolve('../../../src/server/services/workspace-service'),
    filename: require.resolve('../../../src/server/services/workspace-service'),
    loaded: true,
    exports: workspaceService
  };
  require.cache[require.resolve('../../../src/server/services/favorites')] = {
    id: require.resolve('../../../src/server/services/favorites'),
    filename: require.resolve('../../../src/server/services/favorites'),
    loaded: true,
    exports: favoritesService
  };
  require.cache[require.resolve('../../../src/server/services/mcp-service')] = {
    id: require.resolve('../../../src/server/services/mcp-service'),
    filename: require.resolve('../../../src/server/services/mcp-service'),
    loaded: true,
    exports: mcpService
  };
  require.cache[require.resolve('../../../src/server/services/prompts-service')] = {
    id: require.resolve('../../../src/server/services/prompts-service'),
    filename: require.resolve('../../../src/server/services/prompts-service'),
    loaded: true,
    exports: promptsService
  };
  require.cache[require.resolve('../../../src/server/services/ui-config')] = {
    id: require.resolve('../../../src/server/services/ui-config'),
    filename: require.resolve('../../../src/server/services/ui-config'),
    loaded: true,
    exports: {
      loadUIConfig: loadUIConfigMock,
      saveUIConfig: saveUIConfigMock
    }
  };
  require.cache[require.resolve('../../../src/config/loader')] = {
    id: require.resolve('../../../src/config/loader'),
    filename: require.resolve('../../../src/config/loader'),
    loaded: true,
    exports: {
      loadConfig: loadConfigMock,
      saveConfig: saveConfigMock,
      getConfigFilePath: () => path.join(testDir, 'config.json')
    }
  };
  require.cache[require.resolve('../../../src/server/services/notification-hooks')] = {
    id: require.resolve('../../../src/server/services/notification-hooks'),
    filename: require.resolve('../../../src/server/services/notification-hooks'),
    loaded: true,
    exports: {
      getOpenCodeManagedPluginPath: () => ''
    }
  };
  require.cache[require.resolve('../../../src/server/services/opencode-settings-manager')] = {
    id: require.resolve('../../../src/server/services/opencode-settings-manager'),
    filename: require.resolve('../../../src/server/services/opencode-settings-manager'),
    loaded: true,
    exports: {
      CONFIG_PATHS: {
        opencode: path.join(testDir, '.opencode', 'opencode.json'),
        opencodec: path.join(testDir, '.opencode', 'opencode.jsonc'),
        config: path.join(testDir, '.opencode', 'config.json')
      }
    }
  };

  admZipInstances = [];
  require.cache[require.resolve('adm-zip')] = {
    id: require.resolve('adm-zip'),
    filename: require.resolve('adm-zip'),
    loaded: true,
    exports: function AdmZipMock() {
      const files = [];
      const instance = {
        addFile: vi.fn((name, buffer) => files.push({ name, content: buffer.toString('utf8') })),
        toBuffer: vi.fn(() => Buffer.from(JSON.stringify(files))),
        __files: files
      };
      admZipInstances.push(instance);
      return instance;
    }
  };

  // create installed skill files
  for (const platform of ['claude', 'codex', 'gemini', 'opencode']) {
    const skillDir = path.join(testDir, 'skills-install', platform, `${platform}-skill`);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: "${platform} skill"\n---\nbody`, 'utf8');
  }

  fs.mkdirSync(path.join(testDir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }), 'utf8');
  fs.mkdirSync(path.join(testDir, 'store'), { recursive: true });
  fs.writeFileSync(path.join(testDir, 'store', 'ui-config.json'), JSON.stringify({ theme: 'dark' }), 'utf8');
  fs.writeFileSync(path.join(testDir, 'store', 'prompts.json'), JSON.stringify({ activePresetId: null, presets: {} }), 'utf8');
  fs.writeFileSync(path.join(testDir, 'store', 'security.json'), JSON.stringify({ passwordEnabled: false }), 'utf8');
  fs.writeFileSync(path.join(testDir, 'store', 'oauth.json'), JSON.stringify({ version: 1 }), 'utf8');
  fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# Root agents', 'utf8');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-export-service-'));
  stubModules();
  delete require.cache[require.resolve('../../../src/server/services/config-export-service')];
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/config-export-service',
    '../../../src/server/services/config-templates-service',
    '../../../src/server/services/channels',
    '../../../src/server/services/codex-channels',
    '../../../src/server/services/gemini-channels',
    '../../../src/server/services/opencode-channels',
    '../../../src/server/services/agents-service',
    '../../../src/server/services/commands-service',
    '../../../src/server/services/skill-service',
    '../../../src/server/services/workspace-service',
    '../../../src/server/services/favorites',
    '../../../src/server/services/mcp-service',
    '../../../src/server/services/prompts-service',
    '../../../src/server/services/ui-config',
    '../../../src/config/loader',
    '../../../src/config/paths',
    '../../../src/server/services/notification-hooks',
    '../../../src/server/services/opencode-settings-manager',
    'adm-zip'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('config-export-service export flows', () => {
  test('exportAllConfigs builds multi-platform snapshot and filters builtin templates', () => {
    codexChannelsService.getChannels.mockReturnValue({
      channels: [{ id: 'codex-1', name: 'Codex', providerKey: 'openai', enabled: true }]
    });
    const service = require('../../../src/server/services/config-export-service');

    const result = service.exportAllConfigs();

    expect(result.success).toBe(true);
    expect(result.data.data.configTemplates).toEqual([{ id: 'custom', name: 'Custom', isBuiltin: false }]);
    expect(result.data.data.channelsByType.codex).toHaveLength(1);
    expect(result.data.data.skillsByPlatform.gemini[0].directory).toBe('gemini-skill');
    expect(result.data.data.markdownFiles['AGENTS.md']).toBe('# Root agents');
    expect(result.data.data.oauthCredentials).toEqual({ version: 1 });
  });

  test('exportAllConfigsZip packs config.json and README.md', () => {
    const service = require('../../../src/server/services/config-export-service');

    const result = service.exportAllConfigsZip();

    expect(result.success).toBe(true);
    expect(result.filename).toMatch(/^ctx-config-/);
    expect(admZipInstances[0].addFile).toHaveBeenCalledTimes(2);
    expect(admZipInstances[0].__files.map((file) => file.name)).toEqual(['config.json', 'README.md']);
  });
});

describe('config-export-service import flows', () => {
  test('importConfigs validates payload shape', async () => {
    const service = require('../../../src/server/services/config-export-service');

    const result = await service.importConfigs(null);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/无效的导入数据格式/);
  });

  test('importConfigs writes prompts, oauth, markdown and app config, and imports channels/templates', async () => {
    codexChannelsService.getChannels.mockReturnValue({ channels: [] });
    const service = require('../../../src/server/services/config-export-service');
    const importData = {
      version: '1.4.0',
      data: {
        configTemplates: [{ id: 'tpl-1', name: 'Imported Template' }],
        channelsByType: {
          claude: [{ id: 'claude-import', name: 'Claude Import', baseUrl: 'https://claude.import', apiKey: 'ckey' }],
          codex: [{ id: 'codex-import', name: 'Codex Import', providerKey: 'openai', baseUrl: 'https://codex.import', apiKey: 'okey' }]
        },
        markdownFiles: {
          'CLAUDE.md': '# Imported Claude',
          'README.md': '# should be ignored'
        },
        prompts: {
          activePresetId: 'preset-1',
          presets: {
            'preset-1': { id: 'preset-1', name: 'Prompt 1', content: 'prompt body' }
          }
        },
        security: { passwordEnabled: true },
        appConfig: { ports: { webUI: 20000 } },
        oauthCredentials: { version: 2 },
        mcpServers: [{ id: 'fetch', name: 'Fetch', server: { type: 'stdio', command: 'uvx' } }]
      }
    };

    const result = await service.importConfigs(importData, { overwrite: true });

    expect(result.success).toBe(true);
    expect(configTemplatesService.createCustomTemplate).toHaveBeenCalled();
    expect(channelsService.createChannel).toHaveBeenCalled();
    expect(codexChannelsService.createChannel).toHaveBeenCalled();
    expect(promptsService.activatePreset).toHaveBeenCalledWith('preset-1');
    expect(saveConfigMock).toHaveBeenCalledWith({ ports: { webUI: 20000 } });
    expect(mcpService.saveServer).toHaveBeenCalled();
    expect(fs.readFileSync(path.join(testDir, 'CLAUDE.md'), 'utf8')).toBe('# Imported Claude');
    expect(fs.existsSync(path.join(testDir, 'README.md'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(testDir, 'store', 'oauth.json'), 'utf8'))).toEqual({ version: 2 });
    expect(result.results.markdownFiles.success).toBe(1);
    expect(result.results.markdownFiles.failed).toBe(1);
  });
});
