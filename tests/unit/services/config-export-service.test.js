const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

let testDir;
let configTemplatesService;
let channelsService;
let codexChannelsService;
let geminiChannelsService;
let opencodeChannelsService;
let ompChannelsService;
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
let PluginsServiceStub;

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
        oauthCredentials: path.join(testDir, 'store', 'oauth.json'),
        pluginRepos: {
          claude: path.join(testDir, 'repos', 'plugins', 'claude.json'),
          codex: path.join(testDir, 'repos', 'plugins', 'codex.json'),
          gemini: path.join(testDir, 'repos', 'plugins', 'gemini.json'),
          opencode: path.join(testDir, 'repos', 'plugins', 'opencode.json'),
          omp: path.join(testDir, 'repos', 'plugins', 'omp.json')
        },
        pluginMarketCache: {
          claude: path.join(testDir, 'cache', 'plugins', 'claude-market.json'),
          codex: path.join(testDir, 'cache', 'plugins', 'codex-market.json'),
          gemini: path.join(testDir, 'cache', 'plugins', 'gemini-market.json'),
          opencode: path.join(testDir, 'cache', 'plugins', 'opencode-market.json'),
          omp: path.join(testDir, 'cache', 'plugins', 'omp-market.json')
        }
      },
      NATIVE_PATHS: {
        claude: { settings: path.join(testDir, '.claude', 'settings.json') },
        codex: { config: path.join(testDir, '.codex', 'config.toml'), auth: path.join(testDir, '.codex', 'auth.json') },
        gemini: { env: path.join(testDir, '.gemini', '.env') },
        opencode: { config: path.join(testDir, '.opencode') },
        omp: {
          dir: path.join(testDir, '.omp'),
          settings: path.join(testDir, '.omp', 'config.yml'),
          auth: path.join(testDir, '.omp', 'auth.json'),
          models: path.join(testDir, '.omp', 'models.yml'),
          modelsYml: path.join(testDir, '.omp', 'models.yml'),
          extensions: path.join(testDir, '.omp', 'extensions'),
          skills: path.join(testDir, '.omp', 'skills'),
          prompts: path.join(testDir, '.omp', 'prompts'),
          commands: path.join(testDir, '.omp', 'commands'),
          themes: path.join(testDir, '.omp', 'themes'),
          packages: path.join(testDir, '.omp', 'packages')
        }
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
  ompChannelsService = {
    getChannels: vi.fn(() => ({ channels: [{ id: 'omp-1', name: 'OMP', baseUrl: 'https://omp.example', providerKey: 'omp-managed', apiKey: 'pkey', enabled: true }] })),
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
    syncManagedProviderExtension: vi.fn()
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
      if (this.platform === 'omp') {
        return {
          commands: [{
            name: 'omp-command',
            namespace: 'review',
            path: path.join('review', 'omp-command.md'),
            description: '',
            body: 'Review this with OMP',
            fullContent: 'Review this with OMP'
          }]
        };
      }
      if (this.platform === 'codex') {
        return {
          commands: [{
            name: 'codex-command',
            namespace: 'ops',
            path: path.join('ops', 'codex-command.md'),
            description: 'Codex command',
            body: 'Review this with Codex',
            fullContent: 'Review this with Codex'
          }]
        };
      }
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

  class PluginsServiceFake {
    constructor(platform) {
      this.platform = platform;
    }
    listPlugins() {
      const pluginMap = {
        claude: [{
          name: 'claude-native',
          marketplace: 'ctx',
          version: '1.0.0',
          installPath: path.join(testDir, '.claude', 'plugins', 'cache', 'ctx', 'claude-native', '1.0.0'),
          enabled: true,
          source: 'claude-native'
        }],
        codex: [{
          name: 'codex-plugin',
          marketplace: 'ctx',
          version: '2.0.0',
          installPath: path.join(testDir, '.codex', 'plugins', 'cache', 'ctx', 'codex-plugin', '2.0.0'),
          directory: path.join('ctx', 'codex-plugin', '2.0.0'),
          enabled: false,
          source: 'codex-cache',
          repoUrl: 'https://github.com/demo/codex-plugin'
        }],
        gemini: [],
        opencode: [
          {
            name: '@demo/opencode-plugin',
            directory: '@demo/opencode-plugin',
            pluginType: 'npm',
            version: 'latest',
            enabled: true,
            source: 'opencode-config'
          },
          {
            name: 'local-opencode',
            directory: 'local-opencode',
            pluginType: 'local',
            version: '1.0.0',
            installPath: path.join(testDir, '.opencode', 'plugins', 'local-opencode'),
            enabled: true,
            source: 'opencode-local'
          }
        ],
        omp: [
          {
            name: '@demo/omp-package',
            directory: '@demo/omp-package',
            pluginType: 'package',
            pluginKind: 'package',
            version: 'latest',
            enabled: false,
            source: 'omp-settings'
          },
          {
            name: 'omp-extension',
            directory: 'omp-extension',
            pluginType: 'extension-directory',
            pluginKind: 'extension',
            version: 'local',
            installPath: path.join(testDir, '.omp', 'extensions', 'omp-extension'),
            enabled: true,
            source: 'omp-extension'
          }
        ]
      };
      return { plugins: pluginMap[this.platform] || [] };
    }
    getRepos() {
      return [{
        id: `${this.platform}:repo`,
        provider: 'github',
        owner: 'demo',
        name: `${this.platform}-plugins`,
        branch: 'main',
        repoUrl: `https://github.com/demo/${this.platform}-plugins`,
        enabled: true
      }];
    }
  }
  PluginsServiceStub = PluginsServiceFake;

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
  require.cache[require.resolve('../../../src/platforms/drivers/claude/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/claude/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/claude/channels-implementation'),
    loaded: true,
    exports: channelsService
  };
  require.cache[require.resolve('../../../src/platforms/drivers/codex/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/codex/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/codex/channels-implementation'),
    loaded: true,
    exports: codexChannelsService
  };
  require.cache[require.resolve('../../../src/platforms/drivers/gemini/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/gemini/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/gemini/channels-implementation'),
    loaded: true,
    exports: geminiChannelsService
  };
  require.cache[require.resolve('../../../src/platforms/drivers/opencode/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/channels-implementation'),
    loaded: true,
    exports: opencodeChannelsService
  };
  require.cache[require.resolve('../../../src/platforms/drivers/omp/channels-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/omp/channels-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/omp/channels-implementation'),
    loaded: true,
    exports: ompChannelsService
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
  require.cache[require.resolve('../../../src/server/services/plugins-service')] = {
    id: require.resolve('../../../src/server/services/plugins-service'),
    filename: require.resolve('../../../src/server/services/plugins-service'),
    loaded: true,
    exports: { PluginsService: PluginsServiceStub }
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
  require.cache[require.resolve('../../../src/platforms/drivers/opencode/native-config-implementation')] = {
    id: require.resolve('../../../src/platforms/drivers/opencode/native-config-implementation'),
    filename: require.resolve('../../../src/platforms/drivers/opencode/native-config-implementation'),
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
  for (const platform of ['claude', 'codex', 'gemini', 'opencode', 'omp']) {
    const skillDir = path.join(testDir, 'skills-install', platform, `${platform}-skill`);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: "${platform} skill"\n---\nbody`, 'utf8');
  }

  const ompPromptDir = path.join(testDir, 'commands-install', 'omp');
  fs.mkdirSync(path.join(ompPromptDir, 'review'), { recursive: true });
  fs.writeFileSync(path.join(ompPromptDir, 'review', 'omp-command.md'), 'Review this with OMP', 'utf8');

  fs.mkdirSync(path.join(testDir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }), 'utf8');
  const claudePluginDir = path.join(testDir, '.claude', 'plugins', 'cache', 'ctx', 'claude-native', '1.0.0');
  fs.mkdirSync(claudePluginDir, { recursive: true });
  fs.writeFileSync(path.join(claudePluginDir, 'plugin.json'), JSON.stringify({ name: 'claude-native', version: '1.0.0' }), 'utf8');
  fs.writeFileSync(path.join(claudePluginDir, 'README.md'), 'Claude plugin', 'utf8');
  fs.writeFileSync(path.join(testDir, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'claude-native@ctx': [{ installPath: claudePluginDir, version: '1.0.0' }]
    }
  }), 'utf8');
  fs.writeFileSync(path.join(testDir, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({
    ctx: { source: { source: 'directory', path: path.dirname(claudePluginDir) } }
  }), 'utf8');
  const codexPluginDir = path.join(testDir, '.codex', 'plugins', 'cache', 'ctx', 'codex-plugin', '2.0.0');
  fs.mkdirSync(path.join(codexPluginDir, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(codexPluginDir, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'codex-plugin', version: '2.0.0' }), 'utf8');
  fs.writeFileSync(path.join(codexPluginDir, 'README.md'), 'Codex plugin', 'utf8');
  fs.mkdirSync(path.join(testDir, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.codex', 'config.toml'), '[plugins.\"codex-plugin@ctx\"]\nenabled = false\n[marketplaces.ctx]\nsource_type = \"git\"\nsource = \"https://github.com/demo/codex-plugin\"\n', 'utf8');
  const openCodePluginDir = path.join(testDir, '.opencode', 'plugins', 'local-opencode');
  fs.mkdirSync(openCodePluginDir, { recursive: true });
  fs.writeFileSync(path.join(openCodePluginDir, 'package.json'), JSON.stringify({ name: 'local-opencode', version: '1.0.0' }), 'utf8');
  fs.writeFileSync(path.join(testDir, '.opencode', 'opencode.json'), JSON.stringify({ plugin: ['@demo/opencode-plugin'] }), 'utf8');
  const ompExtensionDir = path.join(testDir, '.omp', 'extensions', 'omp-extension');
  fs.mkdirSync(ompExtensionDir, { recursive: true });
  fs.writeFileSync(path.join(ompExtensionDir, 'omp.json'), JSON.stringify({ name: 'omp-extension', version: 'local' }), 'utf8');
  fs.writeFileSync(path.join(ompExtensionDir, 'provider.ts'), 'export default {}', 'utf8');
  fs.mkdirSync(path.join(testDir, '.omp'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.omp', 'config.yml'), yaml.dump({
    packages: ['@demo/omp-package'],
    disabledPackages: ['@demo/omp-package']
  }), 'utf8');
  fs.writeFileSync(path.join(testDir, '.omp', 'auth.json'), JSON.stringify({ token: 'omp-token' }), 'utf8');
  fs.writeFileSync(path.join(testDir, '.omp', 'models.yml'), yaml.dump({ providers: { 'ctx-omp': { models: [{ id: 'omp-fast' }] } } }), 'utf8');
  fs.mkdirSync(path.join(testDir, '.omp', 'prompts', 'review'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.omp', 'prompts', 'review', 'native-prompt.md'), 'Native OMP prompt', 'utf8');
  fs.mkdirSync(path.join(testDir, '.omp', 'skills', 'native-omp-skill'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.omp', 'skills', 'native-omp-skill', 'SKILL.md'), 'Native OMP skill', 'utf8');
  fs.mkdirSync(path.join(testDir, '.omp', 'themes'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.omp', 'themes', 'night.json'), JSON.stringify({ name: 'night' }), 'utf8');
  fs.mkdirSync(path.join(testDir, '.omp', 'packages', 'managed-package'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.omp', 'packages', 'managed-package', 'package.json'), JSON.stringify({ name: 'managed-package' }), 'utf8');
  fs.mkdirSync(path.join(testDir, '.omp', 'npm', '@demo', 'omp-package', 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.omp', 'npm', '@demo', 'omp-package', 'package.json'), JSON.stringify({ name: '@demo/omp-package' }), 'utf8');
  fs.writeFileSync(path.join(testDir, '.omp', 'npm', '@demo', 'omp-package', 'node_modules', 'dep', 'index.js'), 'module.exports = true', 'utf8');
  fs.mkdirSync(path.join(testDir, '.omp', 'git', 'provider'), { recursive: true });
  fs.writeFileSync(path.join(testDir, '.omp', 'git', 'provider', 'package.json'), JSON.stringify({ name: 'provider' }), 'utf8');
  fs.mkdirSync(path.join(testDir, 'store'), { recursive: true });
  for (const platform of ['claude', 'codex', 'gemini', 'opencode', 'omp']) {
    const repoPath = path.join(testDir, 'repos', 'plugins', `${platform}.json`);
    const cachePath = path.join(testDir, 'cache', 'plugins', `${platform}-market.json`);
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(repoPath, JSON.stringify({ repos: [{ owner: 'demo', name: `${platform}-plugins` }] }), 'utf8');
    fs.writeFileSync(cachePath, JSON.stringify({ plugins: [{ name: `${platform}-market-plugin` }] }), 'utf8');
  }
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
    '../../../src/platforms/drivers/claude/channels-implementation',
    '../../../src/platforms/drivers/codex/channels-implementation',
    '../../../src/platforms/drivers/gemini/channels-implementation',
    '../../../src/platforms/drivers/opencode/channels-implementation',
    '../../../src/platforms/drivers/omp/channels-implementation',
    '../../../src/server/services/agents-service',
    '../../../src/server/services/commands-service',
    '../../../src/server/services/skill-service',
    '../../../src/server/services/plugins-service',
    '../../../src/server/services/workspace-service',
    '../../../src/server/services/favorites',
    '../../../src/server/services/mcp-service',
    '../../../src/server/services/prompts-service',
    '../../../src/server/services/ui-config',
    '../../../src/config/loader',
    '../../../src/config/paths',
    '../../../src/server/services/notification-hooks',
    '../../../src/platforms/drivers/opencode/native-config-implementation',
    'adm-zip'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('config-export-service export flows', () => {
  test('exports snapshots for every enabled registry platform', () => {
    const service = require('../../../src/server/services/config-export-service');
    const registry = {
      list: () => [{
        key: 'demo-cli',
        capabilities: { resourceSync: 'generic-filesystem' }
      }, {
        key: 'unsupported-cli',
        capabilities: { resourceSync: 'unsupported' }
      }]
    };

    expect(service.exportPlatformSnapshots({
      registry,
      exportByPlatform: platform => ({ platform })
    })).toEqual({
      'demo-cli': { platform: 'demo-cli' },
      'unsupported-cli': { platform: 'unsupported-cli' }
    });
    expect(service.getPlatformKeysForType('agents', registry)).toEqual(['demo-cli']);
  });
  test('exportAllConfigs builds multi-platform snapshot and filters builtin templates', () => {
    codexChannelsService.getChannels.mockReturnValue({
      channels: [{ id: 'codex-1', name: 'Codex', providerKey: 'openai', enabled: true }]
    });
    const service = require('../../../src/server/services/config-export-service');

    const result = service.exportAllConfigs();

    expect(result.success).toBe(true);
    expect(result.data.data.configTemplates).toEqual([{ id: 'custom', name: 'Custom', isBuiltin: false }]);
    expect(result.data.data.channelsByType.codex).toHaveLength(1);
    expect(result.data.data.channelsByType.omp[0]).toMatchObject({
      id: 'omp-1',
      name: 'OMP',
      providerKey: 'omp-managed'
    });
    expect(result.data.data.agentsByPlatform.gemini[0].fileName).toBe('gemini-agent');
    expect(result.data.data.commandsByPlatform.codex[0]).toMatchObject({
      platform: 'codex',
      name: 'codex-command',
      path: path.join('ops', 'codex-command.md'),
      body: 'Review this with Codex'
    });
    expect(result.data.data.commandsByPlatform.gemini[0].name).toBe('gemini-command');
    expect(result.data.data.commandsByPlatform.omp[0]).toMatchObject({
      platform: 'omp',
      name: 'omp-command',
      path: path.join('review', 'omp-command.md'),
      body: 'Review this with OMP'
    });
    expect(result.data.data.skillsByPlatform.gemini[0].directory).toBe('gemini-skill');
    expect(result.data.data.skillsByPlatform.omp[0]).toMatchObject({
      platform: 'omp',
      directory: 'omp-skill',
      name: 'omp skill'
    });
    expect(Buffer.from(result.data.data.skillsByPlatform.omp[0].files[0].content, 'base64').toString('utf8')).toContain('omp skill');
    expect(result.data.data.pluginsByPlatform.codex.plugins[0]).toMatchObject({
      platform: 'codex',
      name: 'codex-plugin',
      marketplace: 'ctx',
      enabled: false
    });
    expect(result.data.data.pluginsByPlatform.codex.control.nativeConfig.content).toContain('codex-plugin@ctx');
    expect(result.data.data.pluginsByPlatform.opencode.plugins.map(plugin => plugin.name)).toEqual([
      '@demo/opencode-plugin',
      'local-opencode'
    ]);
    expect(result.data.data.pluginsByPlatform.omp.plugins.map(plugin => plugin.name)).toEqual([
      '@demo/omp-package',
      'omp-extension'
    ]);
    expect(result.data.data.pluginsByPlatform.omp.control.nativeSettings).toBeUndefined();
    expect(result.data.data.nativeConfigs.omp.settings.content.packages).toEqual(['@demo/omp-package']);
    expect(result.data.data.nativeConfigs.omp.settings.content.disabledPackages).toEqual(['@demo/omp-package']);
    expect(result.data.data.nativeConfigs.omp.auth.content).toEqual({ token: 'omp-token' });
    expect(result.data.data.nativeConfigs.omp.models.content.providers['ctx-omp'].models[0].id).toBe('omp-fast');
    expect(result.data.data.nativeConfigs.omp.prompts.files.map(file => file.path)).toContain(path.join('review', 'native-prompt.md'));
    expect(result.data.data.nativeConfigs.omp.skills.files.map(file => file.path)).toContain(path.join('native-omp-skill', 'SKILL.md'));
    expect(result.data.data.nativeConfigs.omp.extensions.files.map(file => file.path)).toContain(path.join('omp-extension', 'provider.ts'));
    expect(result.data.data.nativeConfigs.omp.themes.files.map(file => file.path)).toContain('night.json');
    expect(result.data.data.nativeConfigs.omp.packages.files.map(file => file.path)).toContain(path.join('managed-package', 'package.json'));
    expect(result.data.data.nativeConfigs.omp.npmPackages.files.map(file => file.path)).toContain(path.join('@demo', 'omp-package', 'node_modules', 'dep', 'index.js'));
    expect(result.data.data.nativeConfigs.omp.gitPackages.files.map(file => file.path)).toContain(path.join('provider', 'package.json'));
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
    ompChannelsService.getChannels.mockReturnValue({ channels: [] });
    const service = require('../../../src/server/services/config-export-service');
    const importData = {
      version: '1.4.0',
      data: {
        configTemplates: [{ id: 'tpl-1', name: 'Imported Template' }],
        channelsByType: {
          claude: [{ id: 'claude-import', name: 'Claude Import', baseUrl: 'https://claude.import', apiKey: 'ckey' }],
          codex: [{ id: 'codex-import', name: 'Codex Import', providerKey: 'openai', baseUrl: 'https://codex.import', apiKey: 'okey' }],
          omp: [{ id: 'omp-import', name: 'OMP Import', providerKey: 'omp-managed', baseUrl: 'https://omp.import', apiKey: 'pkey', enabled: true }]
        },
        markdownFiles: {
          'CLAUDE.md': '# Imported Claude',
          'README.md': '# should be ignored'
        },
        agentsByPlatform: {
          gemini: [{
            fileName: 'gemini-helper',
            name: 'Gemini Helper',
            description: 'Helps Gemini',
            systemPrompt: 'Help with Gemini work'
          }]
        },
        commandsByPlatform: {
          gemini: [{
            name: 'gemini-review',
            path: 'gemini-review.toml',
            fullContent: 'description = "Review with Gemini"\nprompt = "Review this"\n'
          }],
          omp: [{
            name: 'omp-review',
            path: 'review/omp-review.md',
            fullContent: 'Review this with OMP'
          }]
        },
        skillsByPlatform: {
          omp: [{
            platform: 'omp',
            directory: 'omp-import-skill',
            name: 'OMP Import Skill',
            files: [{
              path: 'SKILL.md',
              encoding: 'base64',
              content: Buffer.from('---\nname: "OMP Import Skill"\n---\nbody').toString('base64')
            }]
          }]
        },
        pluginsByPlatform: {
          codex: {
            plugins: [{
              platform: 'codex',
              type: 'codex-cache',
              name: 'codex-import',
              marketplace: 'ctx',
              version: '1.0.0',
              directory: path.join('ctx', 'codex-import', '1.0.0'),
              enabled: false,
              files: [{
                path: '.codex-plugin/plugin.json',
                encoding: 'base64',
                content: Buffer.from(JSON.stringify({ name: 'codex-import', version: '1.0.0' })).toString('base64')
              }]
            }],
            control: {
              nativeConfig: {
                format: 'text',
                fileName: 'config.toml',
                content: '[plugins."codex-import@ctx"]\nenabled = false\n'
              }
            }
          },
          opencode: {
            plugins: [{
              platform: 'opencode',
              type: 'opencode-package',
              pluginType: 'npm',
              name: '@demo/imported-opencode',
              enabled: true
            }]
          },
          omp: {
            plugins: [
              {
                platform: 'omp',
                type: 'omp-package',
                pluginType: 'package',
                name: 'omp-import-package',
                installSource: 'npm:omp-import-package',
                resourceTypes: ['extensions', 'skills'],
                enabled: false
              },
              {
                platform: 'omp',
                type: 'omp-extension',
                pluginType: 'extension-directory',
                name: 'omp-import',
                directory: 'omp-import',
                files: [{
                  path: 'omp.json',
                  encoding: 'base64',
                  content: Buffer.from(JSON.stringify({ name: 'omp-import' })).toString('base64')
                }]
              }
            ],
            control: {
              nativeSettings: {
                format: 'yaml',
                fileName: 'config.yml',
                content: { packages: ['@demo/imported-omp'], disabledPackages: [] }
              }
            }
          }
        },
        nativeConfigs: {
          omp: {
            settings: {
              format: 'yaml',
              fileName: 'config.yml',
              content: { packages: ['@demo/native-omp'], disabledPackages: [] }
            },
            auth: {
              format: 'json',
              fileName: 'auth.json',
              content: { token: 'imported-omp-token' }
            },
            models: {
              format: 'yaml',
              fileName: 'models.yml',
              content: { providers: { 'ctx-imported': { models: [{ id: 'imported-omp-model' }] } } }
            },
            prompts: {
              format: 'directory',
              fileName: 'prompts',
              files: [{
                path: 'imported/prompt.md',
                encoding: 'base64',
                content: Buffer.from('Imported OMP prompt').toString('base64')
              }]
            },
            npmPackages: {
              format: 'directory',
              fileName: 'npm',
              files: [{
                path: '@demo/native-omp/package.json',
                encoding: 'base64',
                content: Buffer.from(JSON.stringify({ name: '@demo/native-omp' })).toString('base64')
              }]
            },
            themes: {
              format: 'directory',
              fileName: 'themes',
              files: [{
                path: 'imported-theme.json',
                encoding: 'base64',
                content: Buffer.from(JSON.stringify({ name: 'imported-theme' })).toString('base64')
              }]
            },
            packages: {
              format: 'directory',
              fileName: 'packages',
              files: [{
                path: 'imported-package/package.json',
                encoding: 'base64',
                content: Buffer.from(JSON.stringify({ name: 'imported-package' })).toString('base64')
              }]
            },
            gitPackages: {
              format: 'directory',
              fileName: 'git',
              files: [{
                path: 'native-git/package.json',
                encoding: 'base64',
                content: Buffer.from(JSON.stringify({ name: 'native-git' })).toString('base64')
              }]
            }
          }
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
    expect(ompChannelsService.createChannel).toHaveBeenCalledWith('OMP Import', 'https://omp.import', 'pkey', expect.objectContaining({
      providerKey: 'omp-managed',
      enabled: true
    }));
    expect(ompChannelsService.syncManagedProviderExtension).toHaveBeenCalled();
    expect(promptsService.activatePreset).toHaveBeenCalledWith('preset-1');
    expect(saveConfigMock).toHaveBeenCalledWith({ ports: { webUI: 20000 } });
    expect(mcpService.saveServer).toHaveBeenCalled();
    expect(fs.readFileSync(path.join(testDir, 'CLAUDE.md'), 'utf8')).toBe('# Imported Claude');
    expect(fs.readFileSync(path.join(testDir, 'agents-install', 'gemini', 'gemini-helper.md'), 'utf8')).toContain('Help with Gemini work');
    expect(fs.readFileSync(path.join(testDir, 'commands-install', 'gemini', 'gemini-review.toml'), 'utf8')).toContain('Review this');
    expect(fs.readFileSync(path.join(testDir, 'commands-install', 'omp', 'review', 'omp-review.md'), 'utf8')).toBe('Review this with OMP');
    expect(fs.readFileSync(path.join(testDir, 'skills-install', 'omp', 'omp-import-skill', 'SKILL.md'), 'utf8')).toContain('OMP Import Skill');
    expect(fs.existsSync(path.join(testDir, '.codex', 'plugins', 'cache', 'ctx', 'codex-import', '1.0.0', '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(fs.readFileSync(path.join(testDir, '.codex', 'config.toml'), 'utf8')).toContain('codex-import@ctx');
    expect(JSON.parse(fs.readFileSync(path.join(testDir, '.opencode', 'opencode.json'), 'utf8')).plugin).toContain('@demo/imported-opencode');
    expect(fs.existsSync(path.join(testDir, '.omp', 'extensions', 'omp-import', 'omp.json'))).toBe(true);
    expect(yaml.load(fs.readFileSync(path.join(testDir, '.omp', 'config.yml'), 'utf8')).packages).toEqual(['@demo/native-omp']);
    expect(JSON.parse(fs.readFileSync(path.join(testDir, '.omp', 'auth.json'), 'utf8'))).toEqual({ token: 'imported-omp-token' });
    expect(yaml.load(fs.readFileSync(path.join(testDir, '.omp', 'models.yml'), 'utf8'))).toEqual({
      providers: { 'ctx-imported': { models: [{ id: 'imported-omp-model' }] } }
    });
    expect(fs.readFileSync(path.join(testDir, '.omp', 'prompts', 'imported', 'prompt.md'), 'utf8')).toBe('Imported OMP prompt');
    expect(JSON.parse(fs.readFileSync(path.join(testDir, '.omp', 'npm', '@demo', 'native-omp', 'package.json'), 'utf8')).name).toBe('@demo/native-omp');
    expect(JSON.parse(fs.readFileSync(path.join(testDir, '.omp', 'themes', 'imported-theme.json'), 'utf8')).name).toBe('imported-theme');
    expect(JSON.parse(fs.readFileSync(path.join(testDir, '.omp', 'packages', 'imported-package', 'package.json'), 'utf8')).name).toBe('imported-package');
    expect(JSON.parse(fs.readFileSync(path.join(testDir, '.omp', 'git', 'native-git', 'package.json'), 'utf8')).name).toBe('native-git');
    expect(fs.existsSync(path.join(testDir, 'README.md'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(testDir, 'store', 'oauth.json'), 'utf8'))).toEqual({ version: 2 });
    expect(result.results.agents.success).toBe(1);
    expect(result.results.commands.success).toBe(2);
    expect(result.results.skills.success).toBe(1);
    expect(result.results.nativeConfigs.success).toBe(8);
    expect(result.results.markdownFiles.success).toBe(1);
    expect(result.results.markdownFiles.failed).toBe(1);
  });
});
