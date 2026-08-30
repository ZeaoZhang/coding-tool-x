'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
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

});
