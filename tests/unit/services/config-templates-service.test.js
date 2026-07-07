const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

let testDir;
let configDir;
let agentList;
let commandList;
let commandListByPlatform;
let skillsByPlatform;
let pluginList;
let mcpServers;
let mcpPresets;
let promptPresets;
let convertCommandToCodexMock;
let convertCommandToGeminiMock;
let templatesService;

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-templates-service-'));
  configDir = path.join(testDir, '.cc-tool');
  agentList = [
    {
      scope: 'user',
      fileName: 'reviewer',
      name: 'Reviewer',
      description: 'Review changes',
      model: 'gpt-5.4',
      systemPrompt: 'Review carefully'
    },
    {
      scope: 'project',
      fileName: 'project-only',
      name: 'ProjectOnly'
    }
  ];
  commandList = [
    {
      scope: 'user',
      name: 'fix',
      namespace: 'git',
      description: 'Fix issues',
      body: 'echo fix'
    },
    {
      scope: 'project',
      name: 'local-only',
      body: 'skip'
    }
  ];
  commandListByPlatform = {
    claude: commandList,
    codex: [{
      scope: 'user',
      name: 'codex-fix',
      namespace: 'git',
      description: 'Fix issues with Codex',
      body: 'echo codex'
    }],
    gemini: [{
      scope: 'user',
      name: 'gemini-fix',
      description: 'Fix issues with Gemini',
      body: 'echo gemini'
    }],
    opencode: [{
      scope: 'user',
      name: 'opencode-fix',
      description: 'Fix issues with OpenCode',
      body: 'echo opencode'
    }],
    pi: [{
      scope: 'user',
      name: 'inspect',
      namespace: 'pi-tools',
      description: 'Inspect with Pi',
      body: 'Inspect this with Pi'
    }]
  };
  skillsByPlatform = {
    claude: [{ directory: 'skill-claude', name: 'Skill Claude', description: 'Claude skill' }],
    codex: [{ directory: 'skill-codex', description: 'Codex skill' }],
    gemini: [{ directory: 'skill-gemini', name: 'Skill Gemini' }],
    opencode: [{ directory: 'skill-opencode', name: 'Skill OpenCode' }],
    pi: [{ directory: 'skill-pi', name: 'Skill Pi', description: 'Pi skill' }]
  };
  pluginList = [
    { name: 'plugin-a', description: 'Plugin A', version: '1.2.3', source: 'local', repoUrl: 'https://example.com/plugin-a.git' }
  ];
  mcpServers = {
    'local-server': {
      server: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@ctx/local-server'],
        env: { TOKEN: 'abc' },
        cwd: '/workspace/local-server'
      },
      id: 'local-server',
      name: 'Local Server',
      description: 'Local MCP'
    }
  };
  mcpPresets = [
    {
      id: 'preset-server',
      name: 'Preset Server',
      description: 'Preset MCP',
      server: {
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer demo' }
      }
    }
  ];
  promptPresets = {
    builtin: {
      id: 'builtin',
      name: 'Builtin Prompt',
      description: 'Builtin preset',
      content: '# Prompt',
      isBuiltin: true
    }
  };
  convertCommandToCodexMock = vi.fn((content) => ({ content: `CODEX::${content}` }));
  convertCommandToGeminiMock = vi.fn((content) => ({ content: `GEMINI::${content}` }));

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      PATHS: {
        config: configDir
      }
    }
  };

  require.cache[require.resolve('../../../src/server/services/agents-service')] = {
    id: require.resolve('../../../src/server/services/agents-service'),
    filename: require.resolve('../../../src/server/services/agents-service'),
    loaded: true,
    exports: {
      AgentsService: class {
        listAgents() {
          return { agents: agentList };
        }
      }
    }
  };

  require.cache[require.resolve('../../../src/server/services/commands-service')] = {
    id: require.resolve('../../../src/server/services/commands-service'),
    filename: require.resolve('../../../src/server/services/commands-service'),
    loaded: true,
    exports: {
      CommandsService: class {
        constructor(platform = 'claude') {
          this.platform = platform;
        }
        listCommands() {
          return { commands: commandListByPlatform[this.platform] || commandList };
        }
      }
    }
  };

  require.cache[require.resolve('../../../src/server/services/skill-service')] = {
    id: require.resolve('../../../src/server/services/skill-service'),
    filename: require.resolve('../../../src/server/services/skill-service'),
    loaded: true,
    exports: {
      SkillService: class {
        constructor(platform) {
          this.platform = platform;
        }
        getInstalledSkills() {
          return skillsByPlatform[this.platform] || [];
        }
      }
    }
  };

  require.cache[require.resolve('../../../src/server/services/plugins-service')] = {
    id: require.resolve('../../../src/server/services/plugins-service'),
    filename: require.resolve('../../../src/server/services/plugins-service'),
    loaded: true,
    exports: {
      PluginsService: class {
        listPlugins() {
          return { plugins: pluginList };
        }
      }
    }
  };

  require.cache[require.resolve('../../../src/server/services/format-converter')] = {
    id: require.resolve('../../../src/server/services/format-converter'),
    filename: require.resolve('../../../src/server/services/format-converter'),
    loaded: true,
    exports: {
      convertCommandToCodex: convertCommandToCodexMock,
      convertCommandToGemini: convertCommandToGeminiMock
    }
  };

  require.cache[require.resolve('../../../src/server/services/mcp-service')] = {
    id: require.resolve('../../../src/server/services/mcp-service'),
    filename: require.resolve('../../../src/server/services/mcp-service'),
    loaded: true,
    exports: {
      getAllServers: vi.fn(() => mcpServers),
      getPresets: vi.fn(() => mcpPresets)
    }
  };

  require.cache[require.resolve('../../../src/server/services/prompts-service')] = {
    id: require.resolve('../../../src/server/services/prompts-service'),
    filename: require.resolve('../../../src/server/services/prompts-service'),
    loaded: true,
    exports: {
      getAllPresets: vi.fn(() => ({ presets: promptPresets }))
    }
  };

  delete require.cache[require.resolve('../../../src/server/services/config-templates-service')];
  templatesService = require('../../../src/server/services/config-templates-service');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/config-templates-service',
    '../../../src/config/paths',
    '../../../src/server/services/agents-service',
    '../../../src/server/services/commands-service',
    '../../../src/server/services/skill-service',
    '../../../src/server/services/plugins-service',
    '../../../src/server/services/format-converter',
    '../../../src/server/services/mcp-service',
    '../../../src/server/services/prompts-service'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('config-templates-service persistence and discovery', () => {
  test('creates and updates custom templates with normalized AI configs', () => {
    const created = templatesService.createCustomTemplate({
      name: 'Starter',
      cliType: 'claude',
      claudeMd: { enabled: true, content: '# CLAUDE' }
    });

    expect(created).toEqual(expect.objectContaining({
      name: 'Starter',
      cliType: 'claude',
      aiConfigs: {
        claude: { enabled: true, content: '# CLAUDE' },
        codex: { enabled: false, content: '' },
        gemini: { enabled: false, content: '' },
        opencode: { enabled: true, content: '# CLAUDE' },
        pi: { enabled: false, content: '' }
      }
    }));

    const updated = templatesService.updateCustomTemplate(created.id, {
      cliType: 'codex',
      aiConfigs: {
        codex: { enabled: true, content: '# AGENTS' }
      }
    });

    expect(updated).toEqual(expect.objectContaining({
      id: created.id,
      cliType: 'codex',
      aiConfigs: {
        claude: { enabled: true, content: '# CLAUDE' },
        codex: { enabled: true, content: '# AGENTS' },
        gemini: { enabled: false, content: '' },
        opencode: { enabled: true, content: '# AGENTS' },
        pi: { enabled: false, content: '' }
      }
    }));
    expect(typeof updated.updatedAt).toBe('string');
    expect(templatesService.getTemplateById(created.id)).toEqual(expect.objectContaining({
      id: created.id,
      cliType: 'codex'
    }));
  });

  test('aggregates available configs from agents, commands, skills, plugins, MCP, and prompts', () => {
    const result = templatesService.getAvailableConfigs();

    expect(result.skillsByPlatform).toEqual({
      claude: [{ directory: 'skill-claude', name: 'Skill Claude', description: 'Claude skill', repoOwner: null, repoName: null, repoBranch: null }],
      codex: [{ directory: 'skill-codex', name: 'skill-codex', description: 'Codex skill', repoOwner: null, repoName: null, repoBranch: null }],
      gemini: [{ directory: 'skill-gemini', name: 'Skill Gemini', description: '', repoOwner: null, repoName: null, repoBranch: null }],
      opencode: [{ directory: 'skill-opencode', name: 'Skill OpenCode', description: '', repoOwner: null, repoName: null, repoBranch: null }],
      pi: [{ directory: 'skill-pi', name: 'Skill Pi', description: 'Pi skill', repoOwner: null, repoName: null, repoBranch: null }]
    });
    expect(result.agents).toEqual([
      expect.objectContaining({
        fileName: 'reviewer',
        name: 'Reviewer',
        description: 'Review changes',
        model: 'gpt-5.4',
        systemPrompt: 'Review carefully'
      })
    ]);
    expect(result.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'fix',
        namespace: 'git',
        description: 'Fix issues',
        body: 'echo fix'
      })
    ]));
    expect(result.commandsByPlatform.pi).toEqual([
      expect.objectContaining({
        name: 'inspect',
        namespace: 'pi-tools',
        description: 'Inspect with Pi',
        body: 'Inspect this with Pi'
      })
    ]);
    expect(result.plugins).toEqual([
      {
        name: 'plugin-a',
        description: 'Plugin A',
        version: '1.2.3',
        marketplace: null,
        source: 'local',
        repoUrl: 'https://example.com/plugin-a.git'
      }
    ]);
    expect(result.mcpServers).toEqual([
      { id: 'local-server', name: 'Local Server', description: 'Local MCP' }
    ]);
    expect(result.mcpPresets).toEqual([
      { id: 'preset-server', name: 'Preset Server', description: 'Preset MCP' }
    ]);
    expect(result.prompts).toEqual([
      {
        id: 'builtin',
        name: 'Builtin Prompt',
        description: 'Builtin preset',
        content: '# Prompt',
        isBuiltin: true
      }
    ]);
  });
});

describe('config-templates-service apply and preview', () => {
  test('applies templates to project directories across selected AI config types', () => {
    const template = templatesService.createCustomTemplate({
      name: 'Workspace Starter',
      cliType: 'claude',
      aiConfigs: {
        claude: { enabled: true, content: '# CLAUDE' },
        codex: { enabled: true, content: '# AGENTS' },
        gemini: { enabled: true, content: '# GEMINI' },
        opencode: { enabled: true, content: '# OPENCODE' }
      },
      agents: [
        {
          fileName: 'reviewer',
          name: 'Reviewer',
          description: 'Review changes',
          systemPrompt: 'Review carefully'
        }
      ],
      commands: [
        {
          name: 'fix',
          namespace: 'git',
          description: 'Fix issues',
          body: 'echo fix'
        }
      ],
      plugins: [{ name: 'plugin-a' }],
      mcpServers: ['local-server', 'preset-server', 'missing-server']
    });

    const targetDir = path.join(testDir, 'workspace');
    const result = templatesService.applyTemplateToProject(targetDir, template.id, {
      aiConfigTypes: ['claude', 'codex', 'gemini', 'opencode']
    });

    expect(result).toEqual({
      success: true,
      results: {
        aiConfigs: [
          { applied: true, path: 'CLAUDE.md', type: 'Claude', key: 'claude' },
          { applied: true, path: 'AGENTS.md', type: 'Codex', key: 'codex' },
          { applied: true, path: 'GEMINI.md', type: 'Gemini', key: 'gemini' },
          { applied: true, path: '.opencode/AGENTS.md', type: 'OpenCode', key: 'opencode' }
        ],
        skills: { applied: 0, items: [] },
        agents: {
          applied: 1,
          files: ['.claude/agents/reviewer.md', '.opencode/agents/reviewer.md', '.gemini/agents/reviewer.md']
        },
        commands: {
          applied: 1,
          files: [
            '.claude/commands/git/fix.md',
            '.codex/prompts/git/fix.md',
            '.opencode/commands/git/fix.md',
            '.gemini/commands/git/fix.toml'
          ]
        },
        plugins: {
          applied: 1,
          items: ['plugin-a']
        },
        mcpServers: { applied: 2 },
        skipped: [
          { type: 'agent', item: 'reviewer', reason: 'Codex agents 仅支持用户级配置，项目目录应用时已跳过' },
          { type: 'mcpServer', item: 'missing-server', reason: '未找到对应 MCP 服务配置，已跳过' }
        ]
      },
      template: 'Workspace Starter'
    });

    expect(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8')).toBe('# CLAUDE');
    expect(fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8')).toBe('# AGENTS');
    expect(fs.readFileSync(path.join(targetDir, 'GEMINI.md'), 'utf8')).toBe('# GEMINI');
    expect(fs.readFileSync(path.join(targetDir, '.opencode', 'AGENTS.md'), 'utf8')).toBe('# OPENCODE');
    expect(fs.readFileSync(path.join(targetDir, '.claude', 'agents', 'reviewer.md'), 'utf8')).toContain('Review carefully');
    expect(fs.readFileSync(path.join(targetDir, '.gemini', 'agents', 'reviewer.md'), 'utf8')).toContain('Review carefully');
    expect(fs.readFileSync(path.join(targetDir, '.codex', 'prompts', 'git', 'fix.md'), 'utf8')).toContain('CODEX::');
    expect(fs.readFileSync(path.join(targetDir, '.gemini', 'commands', 'git', 'fix.toml'), 'utf8')).toContain('GEMINI::');
    expect(convertCommandToCodexMock).toHaveBeenCalled();
    expect(convertCommandToGeminiMock).toHaveBeenCalled();
    expect(readJson(path.join(targetDir, '.mcp.json'))).toEqual({
      mcpServers: {
        'local-server': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@ctx/local-server'],
          env: { TOKEN: 'abc' },
          cwd: '/workspace/local-server'
        },
        'preset-server': {
          type: 'sse',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer demo' }
        }
      }
    });
    expect(readJson(path.join(targetDir, '.opencode', 'opencode.json'))).toEqual({
      mcp: {
        'local-server': {
          type: 'local',
          command: ['npx', '-y', '@ctx/local-server'],
          environment: { TOKEN: 'abc' },
          cwd: '/workspace/local-server'
        },
        'preset-server': {
          type: 'remote',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer demo' }
        }
      },
      plugin: ['plugin-a']
    });
    expect(readJson(path.join(targetDir, '.ctx-config.json'))).toEqual(expect.objectContaining({
      templateId: template.id,
      aiConfigTypes: ['claude', 'codex', 'gemini', 'opencode'],
      aiConfigPaths: ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.opencode/AGENTS.md'],
      plugins: ['plugin-a'],
      mcpServers: ['local-server', 'preset-server', 'missing-server']
    }));
  });

  test('applies Pi template commands as prompt templates and skips project agents', () => {
    const template = templatesService.createCustomTemplate({
      name: 'Pi Starter',
      cliType: 'pi',
      agents: [
        {
          fileName: 'reviewer',
          name: 'Reviewer',
          description: 'Review changes',
          systemPrompt: 'Review carefully'
        }
      ],
      commands: [
        {
          name: 'inspect',
          namespace: 'pi-tools',
          description: 'Inspect with Pi',
          body: 'Inspect this with Pi'
        }
      ],
      plugins: [{ name: 'plugin-a' }],
      mcpServers: ['local-server']
    });

    const targetDir = path.join(testDir, 'pi-workspace');
    const result = templatesService.applyTemplateToProject(targetDir, template.id, {
      aiConfigTypes: ['pi']
    });

    expect(result).toEqual({
      success: true,
      results: {
        aiConfigs: [],
        skills: { applied: 0, items: [] },
        agents: {
          applied: 0,
          files: []
        },
        commands: {
          applied: 1,
          files: ['.omp/commands/pi-tools/inspect.md']
        },
        plugins: {
          applied: 1,
          items: ['plugin-a']
        },
        mcpServers: { applied: 1 },
        skipped: [
          { type: 'aiConfig', item: 'OMP command templates', reason: 'OMP 项目级命令模板通过 .omp/commands 写入，未生成单独 AI 配置文件' },
          { type: 'agent', item: 'reviewer', reason: 'OMP agents 需通过扩展或包提供，项目目录应用时已跳过' }
        ]
      },
      template: 'Pi Starter'
    });

    expect(fs.readFileSync(path.join(targetDir, '.omp', 'commands', 'pi-tools', 'inspect.md'), 'utf8')).toContain('Inspect this with Pi');
    expect(readJson(path.join(targetDir, '.omp', 'mcp.json'))).toEqual({
      mcpServers: {
        'local-server': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@ctx/local-server'],
          env: { TOKEN: 'abc' },
          cwd: '/workspace/local-server'
        }
      }
    });
    expect(readYaml(path.join(targetDir, '.omp', 'config.yml')).packages).toEqual(['plugin-a']);
    expect(fs.existsSync(path.join(targetDir, '.mcp.json'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, '.omp', 'agents'))).toBe(false);
    expect(readJson(path.join(targetDir, '.ctx-config.json'))).toEqual(expect.objectContaining({
      templateId: template.id,
      aiConfigTypes: ['pi'],
      aiConfigPaths: [],
      commands: ['inspect'],
      mcpServers: ['local-server']
    }));
  });

  test('previews Pi prompt-template command targets and unsupported project agents', () => {
    const template = templatesService.createCustomTemplate({
      name: 'Pi Preview',
      cliType: 'pi',
      agents: [{ fileName: 'reviewer', name: 'Reviewer', systemPrompt: 'Review carefully' }],
      commands: [{ name: 'sync', body: 'echo sync' }],
      plugins: [{ name: 'plugin-a' }],
      mcpServers: ['local-server', 'missing-server']
    });

    const targetDir = path.join(testDir, 'pi-preview-workspace');
    writeFile(path.join(targetDir, '.omp', 'commands', 'sync.md'), 'old prompt');

    const preview = templatesService.previewTemplateApplication(targetDir, template.id, {
      aiConfigTypes: ['pi']
    });

    expect(preview).toEqual({
      willCreate: ['.omp/mcp.json', '.omp/config.yml'],
      willOverwrite: ['.omp/commands/sync.md'],
      skipped: [
        { type: 'aiConfig', item: 'OMP command templates', reason: 'OMP 项目级命令模板通过 .omp/commands 写入，预览不生成单独 AI 配置文件' },
        { type: 'agent', item: 'reviewer', reason: 'OMP agents 需通过扩展或包提供，项目目录预览时已跳过' },
        { type: 'mcpServer', item: 'missing-server', reason: '未找到对应 MCP 服务配置，预览已跳过' }
      ],
      summary: {
        aiConfigs: [],
        skills: 0,
        agents: 0,
        commands: 1,
        plugins: 1,
        mcpServers: 1,
        skipped: 3
      }
    });
  });

  test('previews overwrites and falls back to default AI config when requested types are invalid', () => {
    const template = templatesService.createCustomTemplate({
      name: 'Codex Template',
      cliType: 'codex',
      aiConfigs: {
        codex: { enabled: true, content: '# AGENTS' }
      },
      agents: [{ fileName: 'reviewer', name: 'Reviewer', systemPrompt: 'Review carefully' }],
      commands: [{ name: 'sync', body: 'echo sync' }],
      plugins: [{ name: 'plugin-a' }],
      mcpServers: ['missing-server']
    });

    const targetDir = path.join(testDir, 'preview-workspace');
    writeFile(path.join(targetDir, 'AGENTS.md'), 'old agents');
    writeFile(path.join(targetDir, '.codex', 'prompts', 'sync.md'), 'old command');

    const preview = templatesService.previewTemplateApplication(targetDir, template.id, {
      aiConfigTypes: ['invalid-type']
    });

    expect(preview).toEqual({
      willCreate: [],
      willOverwrite: ['AGENTS.md', '.codex/prompts/sync.md'],
      skipped: [
        { type: 'aiConfigType', item: 'invalid-type', reason: '不支持的 AI 配置类型: invalid-type' },
        { type: 'aiConfigType', item: 'codex', reason: '未提供有效 AI 配置类型，已回退到默认类型: codex' },
        { type: 'agent', item: 'reviewer', reason: 'Codex agents 仅支持用户级配置，项目目录预览时已跳过' },
        { type: 'mcpServer', item: 'missing-server', reason: '未找到对应 MCP 服务配置，预览已跳过' },
        { type: 'plugin', item: 'plugin-a', reason: '当前未选择 OpenCode，已跳过插件写入预览' }
      ],
      summary: {
        aiConfigs: [{ type: 'codex', fileName: 'AGENTS.md', name: 'Codex' }],
        skills: 0,
        agents: 0,
        commands: 1,
        plugins: 0,
        mcpServers: 0,
        skipped: 5
      }
    });
  });
});
