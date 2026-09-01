'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ControlManifestStore } = require('../../../src/server/services/control-manifest-store');
const { EffectiveControlService } = require('../../../src/server/services/effective-control-service');

const PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];

describe('EffectiveControlService', () => {
  let tempDir;
  let projectPath;
  let service;

  const makeSkillEntry = (scope, directory, overrides = {}) => ({
    controlKey: `${scope}:claude:${scope === 'project' ? projectPath : 'user'}:native:claude:${directory}`,
    kind: 'skill',
    platform: 'claude',
    scope,
    projectPath: scope === 'project' ? projectPath : null,
    source: { kind: 'native', repoId: null, fullDirectory: directory, revision: null },
    artifact: {
      root: path.join(tempDir, `${scope}-${directory}`),
      contentHash: 'a'.repeat(64),
      state: 'ready',
      fetchedAt: Date.now()
    },
    targetDirectory: directory,
    cached: true,
    enabled: true,
    trust: 'approved',
    projection: { mode: 'native-copy', state: 'enabled', path: null, updatedAt: null },
    managed: true,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'effective-control-'));
    projectPath = path.join(tempDir, 'project');
    fs.mkdirSync(projectPath, { recursive: true });
    projectPath = fs.realpathSync(projectPath);
    const store = new ControlManifestStore({
      userPath: path.join(tempDir, 'effective-control.json'),
      projectPathResolver: ({ projectPath: canonicalPath }) => path.join(canonicalPath, '.ctx-control.json'),
      fsImpl: fs
    });
    service = new EffectiveControlService({
      store,
      projection: {
        enable: vi.fn(async entry => ({ ...entry.projection, state: 'enabled' })),
        disable: vi.fn(async entry => ({ ...entry.projection, state: 'disabled' }))
      }
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('registers every supported platform without changing platform identity', () => {
    for (const platform of PLATFORMS) {
      const entry = makeSkillEntry('user', `${platform}-skill`, { platform });
      const registered = service.registerSkill(entry);
      expect(registered.platform).toBe(platform);
      expect(registered.managed).toBe(true);
    }
  });

  test('project managed Skill wins over user Skill with same effective identity', () => {
    const user = makeSkillEntry('user', 'shared');
    const project = makeSkillEntry('project', 'shared');
    service.registerSkill(user);
    service.registerSkill(project);

    const snapshot = service.getEffectiveSnapshot({ platform: 'claude', scope: 'project', projectPath });

    expect(snapshot.skills.active).toEqual([
      expect.objectContaining({ scope: 'project', targetDirectory: 'shared', enabled: true })
    ]);
    expect(snapshot.skills.inherited).toEqual([
      expect.objectContaining({ scope: 'user', targetDirectory: 'shared' })
    ]);
  });

  test('disabling a Skill keeps the ready artifact and only changes activation state', () => {
    const entry = makeSkillEntry('user', 'cached');
    service.registerSkill(entry);

    const result = service.setSkillEnabled({
      controlKey: entry.controlKey,
      scope: 'user',
      enabled: false
    });

    expect(result.enabled).toBe(false);
    expect(result.artifact.state).toBe('ready');
    expect(service.getSkill(entry.controlKey, { scope: 'user' }).enabled).toBe(false);
  });

  test('requires approval before enabling pending or blocked Skills', () => {
    const pending = makeSkillEntry('user', 'pending', { enabled: false, trust: 'pending' });
    const blocked = makeSkillEntry('user', 'blocked', { enabled: false, trust: 'blocked' });
    service.registerSkill(pending);
    service.registerSkill(blocked);

    expect(service.setSkillEnabled({ controlKey: pending.controlKey, scope: 'user', enabled: true })).toEqual(
      expect.objectContaining({ status: 'needs_approval', enabled: false })
    );
    expect(service.setSkillEnabled({ controlKey: blocked.controlKey, scope: 'user', enabled: true })).toEqual(
      expect.objectContaining({ status: 'blocked', enabled: false })
    );
  });

  test('supports needs_review as the refresh trust state and rejects project path mismatches', () => {
    const entry = makeSkillEntry('project', 'reviewed', {
      enabled: false,
      trust: 'needs_review'
    });
    service.registerSkill(entry);
    const manifest = service.store.read({ scope: 'project', projectPath });
    manifest.skills[entry.controlKey].projectPath = tempDir;
    service.store.write({ scope: 'project', projectPath }, manifest);
    expect(() => service.setSkillEnabled({
      controlKey: entry.controlKey,
      scope: 'project',
      projectPath,
      enabled: false
    })).toThrow(/projectPath/i);
  });

  test('refuses conflicting enabled Skills with the same projection target', () => {
    const first = makeSkillEntry('user', 'shared-target', {
      controlKey: 'first-control',
      sourceKey: 'repo:first:shared-target'
    });
    const second = makeSkillEntry('user', 'shared-target', {
      controlKey: 'second-control',
      sourceKey: 'repo:second:shared-target',
      enabled: false
    });
    service.registerSkill(first);
    service.registerSkill(second);
    service.setSkillEnabled({ controlKey: first.controlKey, scope: 'user', enabled: true });

    const result = service.setSkillEnabled({
      controlKey: second.controlKey,
      scope: 'user',
      enabled: true
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'conflict',
      enabled: false,
      conflictWith: ['first-control']
    }));
    expect(service.projection.enable).toHaveBeenCalledTimes(1);
  });

  test('checks inherited user projections before enabling a project Skill', () => {
    const user = makeSkillEntry('user', 'shared-project-target', {
      targetDirectory: path.join(tempDir, 'shared-project-target')
    });
    const project = makeSkillEntry('project', 'project-target', {
      targetDirectory: user.targetDirectory,
      enabled: false,
      trust: 'approved'
    });
    service.registerSkill(user);
    service.registerSkill(project);

    expect(service.setSkillEnabled({
      platform: project.platform,
      controlKey: project.controlKey,
      scope: 'project',
      projectPath,
      enabled: true
    })).toEqual(expect.objectContaining({
      status: 'conflict',
      conflictWith: [user.controlKey]
    }));
  });

  test('derives MCP risk and egress policy from transport', () => {
    const entry = service.registerMcp({
      kind: 'mcp',
      controlKey: 'mcp:http',
      platform: 'claude',
      scope: 'user',
      transport: 'streamable_http',
      enabled: false,
      trust: 'approved',
      riskTier: 'read_only',
      egressProfile: 'incorrect',
      secretRefs: []
    });

    expect(entry).toEqual(expect.objectContaining({
      transport: 'streamable_http',
      riskTier: 'external_write',
      egressProfile: 'network'
    }));
  });

  test('rejects complete secret values in MCP control entries', () => {
    expect(() => service.registerMcp({
      kind: 'mcp',
      controlKey: 'mcp:github',
      platform: 'claude',
      scope: 'user',
      enabled: true,
      trust: 'approved',
      secretRefs: ['env:GITHUB_TOKEN'],
      env: { GITHUB_TOKEN: 'secret-value' }
    })).toThrow(/secret/i);
  });
});
