'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('@iarna/toml');
const { BUILT_IN_MANIFESTS, createPlatformRegistry } = require('../../../src/platforms/registry');
const { ProjectConfigService } = require('../../../src/server/services/project-config-service');

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
  test('routes project Skill operations with project scope', async () => {
    const skillService = {
      listSkills: vi.fn(async () => [
        { directory: 'project-skill', sourceScope: 'project', scope: 'project' },
        { directory: 'user-skill', sourceScope: 'user', scope: 'user' }
      ]),
      installLocalSkill: vi.fn(async () => ({ success: true })),
      installSkill: vi.fn(async () => ({ success: true })),
      uninstallSkill: vi.fn(async () => ({ success: true }))
    };
    service = new ProjectConfigService({
      registry: makeRegistry(),
      validateProjectPath: vi.fn(async (candidate) => fs.realpathSync(candidate)),
      skillServiceFactory: vi.fn(() => skillService),
      fsImpl: fs
    });
    const canonicalPath = fs.realpathSync(projectDir);

    await expect(service.listProjectSkills(projectDir, 'codex')).resolves.toEqual(expect.objectContaining({
      supported: true,
      project: [{ directory: 'project-skill', sourceScope: 'project', scope: 'project' }],
      inherited: [{ directory: 'user-skill', sourceScope: 'user', scope: 'user' }]
    }));
    await service.installProjectSkill(projectDir, 'codex', { directory: 'local-skill' });
    await service.installProjectSkill(projectDir, 'codex', {
      directory: 'remote-skill',
      repo: { provider: 'local', localPath: projectDir },
      fullDirectory: 'remote-skill'
    });
    await service.removeProjectSkill(projectDir, 'codex', 'project-skill');

    expect(skillService.listSkills).toHaveBeenCalledWith(false, { scope: 'project', cwd: canonicalPath });
    expect(skillService.installLocalSkill).toHaveBeenCalledWith('local-skill', {
      scope: 'project',
      cwd: canonicalPath
    });
    expect(skillService.installSkill).toHaveBeenCalledWith(
      'remote-skill',
      { provider: 'local', localPath: projectDir },
      'remote-skill',
      { scope: 'project', cwd: canonicalPath }
    );
    expect(skillService.uninstallSkill).toHaveBeenCalledWith('project-skill', {
      scope: 'project',
      cwd: canonicalPath
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
      env: { TOKEN: 'secret' },
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

  test('tests a project MCP server with project cwd and redacts secrets', async () => {
    const client = {
      connect: vi.fn(),
      listTools: vi.fn(async () => [{ name: 'tool' }]),
      close: vi.fn()
    };
    service = new ProjectConfigService({
      registry: makeRegistry(),
      validateProjectPath: vi.fn(async (candidate) => fs.realpathSync(candidate)),
      mcpClientFactory: vi.fn(spec => {
        expect(spec.cwd).toBe(fs.realpathSync(projectDir));
        expect(spec.env.TOKEN).toBe('secret');
        return client;
      }),
      fsImpl: fs
    });

    await service.upsertProjectMcp(projectDir, 'claude', 'local', {
      type: 'stdio',
      command: 'node',
      env: { TOKEN: 'secret' }
    });
    const result = await service.testProjectMcp(projectDir, 'claude', 'local');

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
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
      fsImpl: fs
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
