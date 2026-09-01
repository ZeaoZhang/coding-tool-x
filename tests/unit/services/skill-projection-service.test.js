'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SkillProjectionService } = require('../../../src/server/services/skill-projection-service');

const PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];

function makeRegistry(mode = 'native-copy') {
  return {
    resolve: vi.fn(platform => ({
      key: platform,
      projectResources: {
        skills: { canonicalRoot: `.project-${platform}/skills`, readRoots: [`.project-${platform}/skills`] }
      },
      skillActivation: {
        user: { mode, format: `${platform}-skill-v1` },
        project: { mode, format: `${platform}-skill-v1` }
      }
    }))
  };
}

describe('SkillProjectionService', () => {
  let tempDir;
  let artifactRoot;
  let nativeRoots;
  let service;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-projection-'));
    artifactRoot = path.join(tempDir, 'artifact');
    fs.mkdirSync(path.join(artifactRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(artifactRoot, 'SKILL.md'), '---\nname: demo\n---\nBody');
    fs.writeFileSync(path.join(artifactRoot, 'scripts', 'helper.sh'), '#!/bin/sh\ntrue');
    nativeRoots = Object.fromEntries(PLATFORMS.map(platform => [platform, path.join(tempDir, 'native', platform)]));
    service = new SkillProjectionService({
      registry: makeRegistry(),
      nativeRoots,
      artifactRoot: tempDir,
      fsImpl: fs
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test.each(PLATFORMS)('enables and disables a managed %s Skill without deleting artifact', async platform => {
    const entry = {
      managed: true,
      enabled: true,
      platform,
      scope: 'user',
      sourceKey: `test:${platform}:demo`,
      targetDirectory: 'demo',
      artifact: { root: artifactRoot, state: 'ready' },
      projection: { mode: 'native-copy' }
    };

    const enabled = await service.enable(entry);
    expect(enabled.state).toBe('enabled');
    expect(fs.existsSync(path.join(nativeRoots[platform], 'demo', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(nativeRoots[platform], 'demo', 'scripts', 'helper.sh'))).toBe(true);

    const disabled = await service.disable({ ...entry, projection: enabled });
    expect(disabled.state).toBe('disabled');
    expect(disabled.requiresRestart).toBe(true);
    expect(fs.existsSync(artifactRoot)).toBe(true);
    expect(fs.existsSync(path.join(nativeRoots[platform], 'demo'))).toBe(false);
  });

  test('does not overwrite or remove a target without an ownership marker', () => {
    const target = path.join(nativeRoots.claude, 'foreign');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'foreign');
    const entry = {
      managed: true,
      enabled: true,
      platform: 'claude',
      scope: 'user',
      sourceKey: 'test:claude:managed',
      targetDirectory: 'foreign',
      artifact: { root: artifactRoot, state: 'ready' },
      projection: { mode: 'native-copy' }
    };

    expect(service.enable(entry)).toEqual(expect.objectContaining({
      status: 'conflict'
    }));
    expect(service.disable(entry)).toEqual(expect.objectContaining({
      status: 'conflict'
    }));
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('foreign');
  });


  test('rejects symlinked native Skill roots', () => {
    const realRoot = path.join(tempDir, 'native-root');
    const symlinkRoot = path.join(tempDir, 'native-link');
    fs.mkdirSync(realRoot, { recursive: true });
    fs.symlinkSync(realRoot, symlinkRoot, 'dir');
    const linkedService = new SkillProjectionService({
      registry: makeRegistry(),
      nativeRoots: { claude: symlinkRoot },
      artifactRoot: tempDir,
      fsImpl: fs
    });

    expect(() => linkedService.enable({
      managed: true,
      enabled: true,
      platform: 'claude',
      scope: 'user',
      sourceKey: 'test:symlink',
      targetDirectory: 'demo',
      artifact: { root: artifactRoot, state: 'ready' }
    })).toThrow(/symlink/i);
  });
  test('returns unsupported instead of claiming a project Skill is disabled', async () => {
    service = new SkillProjectionService({
      registry: makeRegistry('unsupported'),
      nativeRoots,
      fsImpl: fs
    });
    const result = await service.disable({
      managed: true,
      enabled: false,
      platform: 'claude',
      scope: 'project',
      projectPath: tempDir,
      targetDirectory: 'demo',
      artifact: { root: artifactRoot, state: 'ready' }
    });

    expect(result.status).toBe('unsupported');
  });

  test('rejects symlink content instead of copying its target', () => {
    fs.symlinkSync('/etc/hosts', path.join(artifactRoot, 'scripts', 'link'));
    expect(() => service.enable({
      managed: true,
      enabled: true,
      platform: 'claude',
      scope: 'user',
      targetDirectory: 'unsafe',
      artifact: { root: artifactRoot, state: 'ready' }
    })).toThrow(/symlink/i);
  });

  test('rejects artifacts outside the configured artifact store', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-projection-outside-'));
    fs.writeFileSync(path.join(outside, 'SKILL.md'), '# Outside');
    try {
      expect(() => service.enable({
        managed: true,
        enabled: true,
        platform: 'claude',
        scope: 'user',
        targetDirectory: 'outside',
        artifact: { root: outside, state: 'ready' }
      })).toThrow(/artifact store/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
