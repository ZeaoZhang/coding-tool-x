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
});
