'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('@iarna/toml');
const { BUILT_IN_MANIFESTS, createPlatformRegistry } = require('../../../src/platforms/registry');
const { ProjectConfigService } = require('../../../src/server/services/project-config-service');
const { ControlManifestStore } = require('../../../src/server/services/control-manifest-store');
const { EffectiveControlService } = require('../../../src/server/services/effective-control-service');

function makeControlService(root) {
  return new EffectiveControlService({
    store: new ControlManifestStore({
      userPath: path.join(root, 'effective-control.json'),
      projectPathResolver: ({ projectPath }) => path.join(projectPath, '.ctx-control.json'),
      fsImpl: fs
    })
  });
}

function makeRegistry() {
  return createPlatformRegistry({
    builtIns: BUILT_IN_MANIFESTS,
    userFile: { platforms: [] }
  });
}

describe('project-config-service', () => {
  let projectDir;
  let service;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-config-service-'));
    service = new ProjectConfigService({
      registry: makeRegistry(),
      validateProjectPath: vi.fn(async (candidate) => fs.realpathSync(candidate)),
      skillServiceFactory: vi.fn(() => ({
        scanSkills: vi.fn(async () => ({ skills: [] }))
      })),
      controlService: makeControlService(projectDir),
      fsImpl: fs
    });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('writes and reads the Codex project instruction file', async () => {
    await service.writeInstruction(projectDir, 'codex', '# Project rules');

    await expect(service.readInstruction(projectDir, 'codex')).resolves.toEqual(expect.objectContaining({
      supported: true,
      path: 'AGENTS.md',
      exists: true,
      content: '# Project rules'
    }));
    expect(fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8')).toBe('# Project rules');
  });

  test('normalizes validator failures to an invalid project path error', async () => {
    await expect(service.writeInstruction(path.join(projectDir, 'missing'), 'codex', '# Rules'))
      .rejects.toThrow('Invalid project path');
  });

  test('returns unsupported for OMP instruction files', async () => {
    await expect(service.readInstruction(projectDir, 'omp')).resolves.toEqual(expect.objectContaining({
      supported: false,
      path: null,
      exists: false
    }));
  });

  test('returns a project snapshot with canonical path and capabilities', async () => {
    const snapshot = await service.getSnapshot(projectDir, 'codex');

    expect(snapshot).toEqual(expect.objectContaining({
      success: true,
      projectPath: fs.realpathSync(projectDir),
      platform: 'codex',
      instruction: expect.objectContaining({ path: 'AGENTS.md', supported: true }),
      skills: expect.objectContaining({ supported: true, project: [], inherited: [] }),
      mcp: expect.objectContaining({ supported: true, path: '.codex/config.toml', servers: [] }),
      capabilities: { instruction: true, skills: true, mcp: true }
    }));
  });
  test('routes project Skill scans and toggles through the control plane', async () => {
    const skillService = {
      scanSkills: vi.fn(async () => ({
        skills: [
          { directory: 'project-skill', sourceScope: 'project', scope: 'project' },
          { directory: 'user-skill', sourceScope: 'user', scope: 'user' }
        ],
        refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
      })),
      controlService: {
        setSkillEnabled: vi.fn(() => ({
          controlKey: 'project-skill',
          enabled: false,
          status: 'disabled'
        }))
      }
    };
    service = new ProjectConfigService({
      registry: makeRegistry(),
      validateProjectPath: vi.fn(async (candidate) => fs.realpathSync(candidate)),
      skillServiceFactory: vi.fn(() => skillService),
      controlService: makeControlService(projectDir),
    });
    const canonicalPath = fs.realpathSync(projectDir);

    await expect(service.listProjectSkills(projectDir, 'codex')).resolves.toEqual(expect.objectContaining({
      supported: true,
      project: [{ directory: 'project-skill', sourceScope: 'project', scope: 'project' }],
      inherited: [{ directory: 'user-skill', sourceScope: 'user', scope: 'user' }]
    }));
    await expect(service.setProjectSkillEnabled(projectDir, 'codex', 'project-skill', false))
      .resolves.toEqual(expect.objectContaining({ enabled: false, status: 'disabled' }));

    expect(skillService.scanSkills).toHaveBeenCalledWith({ scope: 'project', cwd: canonicalPath });
    expect(skillService.controlService.setSkillEnabled).toHaveBeenCalledWith({
      platform: 'codex',
      controlKey: 'project-skill',
      scope: 'project',
      projectPath: canonicalPath,
      enabled: false
    });
  });
  test('updates only the Codex project MCP server and preserves unrelated config', async () => {
    fs.mkdirSync(path.join(projectDir, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.codex', 'config.toml'),
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.existing]',
        'command = "existing"',
        '',
        '[custom]',
        'value = "preserve"',
        ''
      ].join('\n'),
      'utf8'
    );

    await service.upsertProjectMcp(projectDir, 'codex', 'new-server', {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: '${TOKEN}' },
      enabled: false,
      enabled_tools: ['read'],
      startup_timeout_sec: 12
    });

    const config = toml.parse(fs.readFileSync(path.join(projectDir, '.codex', 'config.toml'), 'utf8'));
    expect(config.model).toBe('gpt-5');
    expect(config.mcp_servers['new-server'].enabled).toBe(false);
    expect(config.mcp_servers['new-server'].enabled_tools).toEqual(['read']);
    expect(config.mcp_servers['new-server'].startup_timeout_sec).toBe(12);
    expect(config.custom.value).toBe('preserve');
    expect(config.mcp_servers.existing.command).toBe('existing');
    expect(config.mcp_servers['new-server'].command).toBe('node');
  });

  test('tests a project MCP server with project cwd, initialization, and redacts secrets', async () => {
    const client = {
      connected: false,
      connect: vi.fn(async () => { client.connected = true; }),
      initialize: vi.fn(async () => {}),
      listTools: vi.fn(async () => [{ name: 'tool' }]),
      close: vi.fn()
    };
    service = new ProjectConfigService({
      registry: makeRegistry(),
      validateProjectPath: vi.fn(async (candidate) => fs.realpathSync(candidate)),
      mcpClientFactory: vi.fn(spec => {
        expect(spec.cwd).toBe(fs.realpathSync(projectDir));
        expect(spec.env.TOKEN).toBe('${TOKEN}');
        return client;
      }),
      controlService: makeControlService(projectDir),
    });

    await service.upsertProjectMcp(projectDir, 'claude', 'local', {
      type: 'stdio',
      command: 'node',
      env: { TOKEN: '${TOKEN}' }
    });
    const result = await service.testProjectMcp(projectDir, 'claude', 'local');

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.initialize).toHaveBeenCalledTimes(1);
    expect(client.listTools).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('refuses project MCP tests when effective control is disabled', async () => {
    const clientFactory = vi.fn();
    service = new ProjectConfigService({
      registry: makeRegistry(),
      validateProjectPath: vi.fn(async candidate => fs.realpathSync(candidate)),
      mcpClientFactory: clientFactory,
      controlService: makeControlService(projectDir)
    });

    await service.upsertProjectMcp(projectDir, 'claude', 'disabled', {
      type: 'stdio',
      command: 'node',
      enabled: false
    });

    await expect(service.testProjectMcp(projectDir, 'claude', 'disabled'))
      .rejects.toMatchObject({ code: 'MCP_DISABLED' });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  test('preserves omitted and redacted MCP secrets while patching project specs', async () => {
    await service.upsertProjectMcp(projectDir, 'claude', 'demo', {
      type: 'stdio',
      command: 'node',
      env: { TOKEN: '${TOKEN}' }
    });
    await service.upsertProjectMcp(projectDir, 'claude', 'demo', {
      type: 'stdio',
      command: 'node-new',
      env: { TOKEN: '[REDACTED]' }
    });

    const config = JSON.parse(fs.readFileSync(path.join(projectDir, '.mcp.json'), 'utf8'));
    expect(config.mcpServers.demo.command).toBe('node-new');
    expect(config.mcpServers.demo.env.TOKEN).toBe('${TOKEN}');
  });

  test('removes stale transport fields when project MCP transport changes', async () => {
    await service.upsertProjectMcp(projectDir, 'claude', 'demo', {
      type: 'stdio',
      command: 'node',
      args: ['server.js']
    });
    await service.upsertProjectMcp(projectDir, 'claude', 'demo', {
      type: 'streamable_http',
      url: 'http://127.0.0.1:8000/mcp'
    });

    const config = JSON.parse(fs.readFileSync(path.join(projectDir, '.mcp.json'), 'utf8'));
    expect(config.mcpServers.demo.type).toBe('streamable_http');
    expect(config.mcpServers.demo.url).toBe('http://127.0.0.1:8000/mcp');
    expect(config.mcpServers.demo.command).toBeUndefined();
    expect(config.mcpServers.demo.args).toBeUndefined();
  });

  test('rejects prototype-polluting MCP server IDs', async () => {
    await expect(service.upsertProjectMcp(projectDir, 'claude', '__proto__', {
      type: 'stdio',
      command: 'node'
    })).rejects.toThrow(/ID|invalid|prototype/i);
  });


  test('rejects literal project MCP secrets', async () => {
    await expect(service.upsertProjectMcp(projectDir, 'claude', 'literal-secret', {
      type: 'stdio',
      command: 'node',
      env: { API_TOKEN: 'not-allowed' }
    })).rejects.toThrow(/environment variable|secret/i);
  });

  test('rejects literal secrets in project MCP command arguments', async () => {
    await expect(service.upsertProjectMcp(projectDir, 'claude', 'command-secret', {
      type: 'stdio',
      command: 'node',
      args: ['--token', 'literal-secret']
    })).rejects.toThrow(/environment variable|secret/i);
    await expect(service.upsertProjectMcp(projectDir, 'claude', 'slash-command-secret', {
      type: 'stdio',
      command: 'node',
      args: ['/token', 'literal-secret']
    })).rejects.toThrow(/environment variable|secret/i);
  });
  test('rejects credentials hidden in extended MCP fields and URL userinfo', async () => {
    await expect(service.upsertProjectMcp(projectDir, 'claude', 'oauth-secret', {
      type: 'streamable_http',
      url: 'https://user@example.com/mcp',
      oauth: { clientSecret: 'inline-secret' }
    })).rejects.toThrow(/inline secrets|credentials/i);
  });

  test('registers native project MCP as external and refuses deletion', async () => {
    const configPath = path.join(projectDir, '.mcp.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { external: { type: 'stdio', command: 'node' } }
    }), 'utf8');

    const listed = await service.listProjectMcp(projectDir, 'claude');
    expect(listed.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'external', managed: false, external: true })
    ]));
    const updated = await service.upsertProjectMcp(projectDir, 'claude', 'external', {
      type: 'stdio',
      command: 'node-new'
    });
    expect(updated).toEqual(expect.objectContaining({ success: false, status: 'unsupported' }));
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('node-new');
    const removed = await service.removeProjectMcp(projectDir, 'claude', 'external');
    expect(removed).toEqual(expect.objectContaining({ success: false, status: 'unsupported' }));
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test('rejects project MCP stdio cwd outside the validated project root', async () => {
    const clientFactory = vi.fn();
    service = new ProjectConfigService({
      registry: makeRegistry(),
      validateProjectPath: vi.fn(async candidate => fs.realpathSync(candidate)),
      controlService: makeControlService(projectDir),
      mcpClientFactory: clientFactory,
      fsImpl: fs
    });
    await service.upsertProjectMcp(projectDir, 'claude', 'outside-cwd', {
      type: 'stdio',
      command: 'node',
      cwd: os.tmpdir()
    });

    await expect(service.testProjectMcp(projectDir, 'claude', 'outside-cwd'))
      .rejects.toThrow(/cwd|project root/i);
    expect(clientFactory).not.toHaveBeenCalled();
  });
  test('includes project Skills in the aggregate snapshot', async () => {
    const skillService = {
      listSkills: vi.fn(async () => [
        { directory: 'project-skill', scope: 'project', sourceScope: 'project' }
      ])
    };
    service = new ProjectConfigService({
      registry: makeRegistry(),
      validateProjectPath: vi.fn(async (candidate) => fs.realpathSync(candidate)),
      skillServiceFactory: vi.fn(() => skillService),
      controlService: makeControlService(projectDir),
    });

    const snapshot = await service.getSnapshot(projectDir, 'codex');

    expect(snapshot.skills.project).toEqual([
      { directory: 'project-skill', scope: 'project', sourceScope: 'project' }
    ]);
    expect(skillService.listSkills).toHaveBeenCalledWith(false, {
      scope: 'project',
      cwd: fs.realpathSync(projectDir)
    });
  });

  test.each([
    ['claude', '.mcp.json', config => config.mcpServers],
    ['gemini', path.join('.gemini', 'settings.json'), config => config.mcpServers],
    ['opencode', path.join('.opencode', 'opencode.json'), config => config.mcp],
    ['omp', path.join('.omp', 'mcp.json'), config => config.mcpServers]
  ])('supports project MCP for %s', async (platform, relativePath, getServers) => {
    await service.upsertProjectMcp(projectDir, platform, 'local', {
      type: 'stdio',
      command: 'node',
      args: ['server.js']
    });

    const configPath = path.join(projectDir, relativePath);
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(getServers(config)).toHaveProperty('local');

    const result = await service.listProjectMcp(projectDir, platform);
    expect(result.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local', scope: 'project' })
    ]));
  });

});
