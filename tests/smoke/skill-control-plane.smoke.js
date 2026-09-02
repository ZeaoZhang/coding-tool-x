'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-control-smoke-'));
const platforms = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
const repoRoot = path.join(root, 'repo');
const artifactRoot = path.join(root, 'artifacts');
const projectRoot = path.join(root, 'project');
fs.mkdirSync(projectRoot, { recursive: true });
for (const [name, files] of Object.entries({
  alpha: {
    'SKILL.md': '---\nname: Alpha\ndescription: Alpha skill\n---\nUse alpha',
    'references/guide.md': 'alpha guide'
  },
  beta: {
    'SKILL.md': '---\nname: Beta\ndescription: Beta skill\n---\nUse beta',
    'scripts/helper.sh': '#!/bin/sh\ntrue'
  }
})) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(repoRoot, 'skills', name, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

const nativeRoots = Object.fromEntries(platforms.map(platform => [platform, path.join(root, 'native', platform)]));
const pathsModulePath = require.resolve('../../src/config/paths');
require.cache[pathsModulePath] = {
  id: pathsModulePath,
  filename: pathsModulePath,
  loaded: true,
  exports: {
    HOME_DIR: root,
    PATHS: {
      base: root,
      config: path.join(root, 'config'),
      configRegistry: path.join(root, 'config', 'config-registry.json'),
      configs: path.join(root, 'config', 'configs'),
      effectiveControlManifest: path.join(root, 'config', 'effective-control.json'),
      skillArtifacts: artifactRoot,
      skillRefreshTasks: path.join(root, 'runtime', 'skill-refresh-tasks.json'),
      localSkills: Object.fromEntries(platforms.map(platform => [platform, path.join(root, 'local', platform)])),
      skillRepos: Object.fromEntries(platforms.map(platform => [platform, path.join(root, 'repos', `${platform}.json`)])),
      skillCaches: Object.fromEntries(platforms.map(platform => [platform, path.join(root, 'cache', `${platform}.json`)])),
      pluginRepos: Object.fromEntries(platforms.map(platform => [platform, path.join(root, 'repos', `${platform}-plugins.json`)])),
      pluginMarketCache: Object.fromEntries(platforms.map(platform => [platform, path.join(root, 'cache', `${platform}-plugins.json`)])),
    },
    NATIVE_PATHS: {
      claude: { dir: path.join(root, 'native', 'claude'), settings: path.join(root, 'native', 'claude', 'settings.json'), skills: nativeRoots.claude, plugins: path.join(root, 'native', 'claude', 'plugins') },
      codex: { dir: path.join(root, 'native', 'codex'), config: path.join(root, 'native', 'codex', 'config.toml') },
      gemini: { dir: path.join(root, 'native', 'gemini'), env: path.join(root, 'native', 'gemini', '.env'), skills: nativeRoots.gemini },
      opencode: { dir: path.join(root, 'native', 'opencode'), config: path.join(root, 'native', 'opencode') },
      omp: { dir: path.join(root, 'native', 'omp'), skills: nativeRoots.omp }
    },
    ensureStorageDirMigrated: () => {}
  }
};
const ompConfigPath = require.resolve('../../src/platforms/drivers/omp/config');
require.cache[ompConfigPath] = {
  id: ompConfigPath,
  filename: ompConfigPath,
  loaded: true,
  exports: {
    getOmpPaths: () => ({ skills: nativeRoots.omp, agentDir: path.join(root, 'native', 'omp'), settings: path.join(root, 'native', 'omp', 'config.yml'), settingsJsonLegacy: path.join(root, 'native', 'omp', 'settings.json') }),
    readOmpSettings: () => ({ skills: { enabled: true } }),
    getOmpCommand: () => 'omp'
  }
};

const { BUILT_IN_MANIFESTS, createPlatformRegistry } = require('../../src/platforms/registry');
const registry = createPlatformRegistry({ builtIns: BUILT_IN_MANIFESTS, userFile: { platforms: [] } });
const { ControlManifestStore } = require('../../src/server/services/control-manifest-store');
const { EffectiveControlService } = require('../../src/server/services/effective-control-service');
const { SkillArtifactStore } = require('../../src/server/services/skill-artifact-store');
const { SkillProjectionService } = require('../../src/server/services/skill-projection-service');
const { SkillRefreshTaskService } = require('../../src/server/services/skill-refresh-task-service');
const { SkillService } = require('../../src/server/services/skill-service');
const { ProjectConfigService } = require('../../src/server/services/project-config-service');

const controlStore = new ControlManifestStore({
  userPath: path.join(root, 'config', 'effective-control.json'),
  projectPathResolver: ({ projectPath: canonicalPath }) => path.join(canonicalPath, '.ctx-control.json'),
  fsImpl: fs
});
const artifactStore = new SkillArtifactStore({ root: artifactRoot, fsImpl: fs });
const projection = new SkillProjectionService({ registry, nativeRoots, fsImpl: fs });
const controlService = new EffectiveControlService({ store: controlStore, projection });
(async () => {
  for (const platform of platforms) {
    const service = new SkillService(platform, { registry, artifactStore, controlService });
    service.loadRepos = () => [{
      id: 'local:smoke-repo::skills',
      provider: 'local',
      localPath: repoRoot,
      directory: 'skills',
      branch: 'main',
      enabled: true
    }];
    const tasks = new SkillRefreshTaskService({
      persistencePath: path.join(root, 'runtime', 'skill-refresh-tasks.json'),
      worker: context => service.refreshRemoteSkills(context)
    });
    assert.strictEqual(tasks.listRecent({ platform, scope: 'user' }).length, 0);
    const queued = tasks.enqueue({ platform, scope: 'user', reason: 'manual' });
    const duplicate = tasks.enqueue({ platform, scope: 'user', reason: 'manual' });
    assert.strictEqual(duplicate.id, queued.id);
    const completed = await tasks.waitFor(queued.id);
    assert.strictEqual(completed.status, 'succeeded');
    assert.strictEqual(completed.fetchedSkills, 2);

    let scannedFetches = 0;
    const fetchBundles = service.fetchRepoSkillBundles;
    service.fetchRepoSkillBundles = async (...args) => {
      scannedFetches++;
      return fetchBundles.call(service, ...args);
    };
    const scan = await service.scanSkills({ scope: 'user' });
    service.fetchRepoSkillBundles = fetchBundles;
    assert.strictEqual(scannedFetches, 0);
    assert.strictEqual(scan.refresh.state, 'succeeded');

    for (const directory of ['alpha', 'beta']) {
      const sourceKey = `repo:local:smoke-repo::skills:skills/${directory}`;
      const artifact = artifactStore.get({ platform, sourceKey, format: `${platform}-skill-v1` });
      assert.ok(artifact, `${platform} artifact missing for ${directory}`);
      assert.ok(fs.existsSync(path.join(artifact.root, 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(artifact.root, directory === 'alpha' ? 'references/guide.md' : 'scripts/helper.sh')));
      const controlKey = `skill:${platform}:user:user:${sourceKey}`;
      const pending = controlService.getSkill(controlKey, { scope: 'user' });
      assert.strictEqual(pending.managed, true);
      assert.strictEqual(pending.enabled, false);
      assert.strictEqual(pending.trust, 'needs_review');

      controlService.setSkillTrust({ controlKey, scope: 'user', trust: 'approved' });
      const enabled = controlService.setSkillEnabled({ controlKey, scope: 'user', enabled: true });
      assert.strictEqual(enabled.enabled, true);
      assert.ok(fs.existsSync(path.join(nativeRoots[platform], directory, 'SKILL.md')));
      const disabled = controlService.setSkillEnabled({ controlKey, scope: 'user', enabled: false });
      assert.strictEqual(disabled.enabled, false);
      assert.ok(fs.existsSync(artifact.root));
      assert.strictEqual(fs.existsSync(path.join(nativeRoots[platform], directory)), false);
    }

    const alphaKey = `repo:local:smoke-repo::skills:skills/alpha`;
    const alphaControlKey = `skill:${platform}:user:user:${alphaKey}`;
    controlService.setSkillEnabled({ controlKey: alphaControlKey, scope: 'user', enabled: true });
    assert.ok(fs.existsSync(path.join(nativeRoots[platform], 'alpha', 'SKILL.md')));
    fs.appendFileSync(path.join(repoRoot, 'skills', 'alpha', 'SKILL.md'), `\nrefresh-${platform}`);
    const revisionTask = tasks.enqueue({ platform, scope: 'user', reason: 'manual' });
    const revisionResult = await tasks.waitFor(revisionTask.id);
    assert.strictEqual(revisionResult.status, 'succeeded');
    const changed = controlService.getSkill(alphaControlKey, { scope: 'user' });
    assert.strictEqual(changed.trust, 'needs_review');
    assert.strictEqual(changed.enabled, false);
    assert.ok(fs.existsSync(changed.artifact.root));
    assert.strictEqual(fs.existsSync(path.join(nativeRoots[platform], 'alpha')), false);
  }

  const claudeService = new SkillService('claude', { registry, artifactStore, controlService });
  const userShared = path.join(nativeRoots.claude, 'shared');
  const projectShared = path.join(projectRoot, '.claude', 'skills', 'shared');
  fs.mkdirSync(userShared, { recursive: true });
  fs.mkdirSync(projectShared, { recursive: true });
  fs.writeFileSync(path.join(userShared, 'SKILL.md'), '---\nname: Shared\n---\nUser');
  fs.writeFileSync(path.join(projectShared, 'SKILL.md'), '---\nname: Shared\n---\nProject');
  const projectScan = await claudeService.scanSkills({
    scope: 'project',
    cwd: fs.realpathSync(projectRoot)
  });
  const shared = projectScan.skills.find(skill => skill.directory === 'shared');
  assert.strictEqual(shared.sourceScope, 'project');
  assert.ok(shared.shadowedSources.some(source => source.sourceScope === 'user'));
  assert.ok(fs.existsSync(path.join(userShared, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(projectShared, 'SKILL.md')));

  const unsupportedRegistry = {
    ...registry,
    resolve(platform) {
      const manifest = registry.resolve(platform);
      return {
        ...manifest,
        skillActivation: {
          ...manifest.skillActivation,
          project: { mode: 'unsupported', format: null }
        }
      };
    }
  };
  const unsupportedControl = new EffectiveControlService({
    store: controlStore,
    projection: new SkillProjectionService({
      registry: unsupportedRegistry,
      nativeRoots,
      artifactRoot,
      fsImpl: fs
    })
  });
  const unsupportedKey = 'skill:claude:project:unsupported:native:claude:unsupported';
  unsupportedControl.registerSkill({
    kind: 'skill',
    controlKey: unsupportedKey,
    platform: 'claude',
    scope: 'project',
    projectPath: fs.realpathSync(projectRoot),
    sourceKey: 'native:claude:unsupported',
    source: { kind: 'native', fullDirectory: 'unsupported' },
    artifact: {
      root: artifactStore.get({
        platform: 'claude',
        sourceKey: 'repo:local:smoke-repo::skills:skills/alpha',
        format: 'claude-skill-v1'
      }).root,
      state: 'ready'
    },
    targetDirectory: 'unsupported',
    cached: true,
    enabled: true,
    trust: 'approved',
    projection: { mode: 'unsupported', state: 'unsupported' },
    managed: true
  });
  const unsupportedResult = unsupportedControl.setSkillEnabled({
    controlKey: unsupportedKey,
    scope: 'project',
    projectPath: fs.realpathSync(projectRoot),
    enabled: false
  });
  assert.strictEqual(unsupportedResult.status, 'unsupported');

  const mcpClient = {
    connect: async () => {},
    initialize: async () => {},
    listTools: async () => [{ name: 'smoke-tool' }],
    close: async () => {}
  };
  const projectConfig = new ProjectConfigService({
    registry,
    controlService,
    validateProjectPath: async candidate => fs.realpathSync(candidate),
    mcpClientFactory: spec => {
      assert.strictEqual(spec.cwd, fs.realpathSync(projectRoot));
      assert.strictEqual(spec.env.TOKEN, '${TOKEN}');
      return mcpClient;
    },
    fsImpl: fs
  });
  await projectConfig.upsertProjectMcp(projectRoot, 'claude', 'smoke-mcp', {
    type: 'stdio',
    command: 'node',
    env: { TOKEN: '${TOKEN}' }
  });
  const mcpResult = await projectConfig.testProjectMcp(projectRoot, 'claude', 'smoke-mcp');
  assert.strictEqual(mcpResult.success, true);
  assert.ok(!JSON.stringify(mcpResult).includes('secret-value'));
  const mcpList = await projectConfig.listProjectMcp(projectRoot, 'claude');
  assert.ok(mcpList.servers.some(server => server.id === 'smoke-mcp' && server.managed));

  const projectMcpPath = path.join(projectRoot, '.mcp.json');
  const projectMcpConfig = JSON.parse(fs.readFileSync(projectMcpPath, 'utf8'));
  projectMcpConfig.mcpServers.external = { type: 'stdio', command: 'node' };
  fs.writeFileSync(projectMcpPath, JSON.stringify(projectMcpConfig));
  await projectConfig.listProjectMcp(projectRoot, 'claude');
  const externalRemoval = await projectConfig.removeProjectMcp(projectRoot, 'claude', 'external');
  assert.strictEqual(externalRemoval.status, 'unsupported');
  assert.ok(fs.existsSync(projectMcpPath));

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config', 'effective-control.json'), 'utf8'));
  assert.strictEqual(manifest.version, 1);
  assert.ok(Object.keys(manifest.skills).length >= platforms.length * 2);
  console.log(`skill-control-plane smoke: PASS (${platforms.length} platforms, ${platforms.length * 2} Skill artifacts, project/MCP scope checks)`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
