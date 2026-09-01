const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SkillService } = require('../src/server/services/skill-service');
const { ControlManifestStore } = require('../src/server/services/control-manifest-store');
const { EffectiveControlService } = require('../src/server/services/effective-control-service');
const { SkillArtifactStore } = require('../src/server/services/skill-artifact-store');
const { SkillProjectionService } = require('../src/server/services/skill-projection-service');
const { SkillRefreshTaskService } = require('../src/server/services/skill-refresh-task-service');

function createTempSkillService(platform = 'claude') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-skill-test-'));
  const installDir = path.join(tempRoot, 'install');
  const artifactRoot = path.join(tempRoot, 'artifacts');
  const registry = require('../src/platforms/runtime').getPlatformRegistry();
  const controlStore = new ControlManifestStore({
    userPath: path.join(tempRoot, 'effective-control.json'),
    projectPathResolver: ({ projectPath }) => path.join(projectPath, '.ctx-control.json')
  });
  const controlService = new EffectiveControlService({
    store: controlStore,
    projection: new SkillProjectionService({
      registry,
      nativeRoots: { [platform]: installDir },
      artifactRoot
    })
  });
  const service = new SkillService(platform, {
    registry,
    artifactStore: new SkillArtifactStore({ root: artifactRoot }),
    controlService
  });
  service.configDir = path.join(tempRoot, 'config');
  service.installDir = installDir;
  service.storageDir = path.join(service.configDir, 'storage');
  service.reposConfigPath = path.join(service.configDir, 'repos.json');
  if (platform === 'omp') service.refreshOmpPaths = () => {};
  service.cachePath = path.join(service.configDir, 'skills-cache.json');
  service.ensureDirs();
  service.saveRepos([]);
  return { service, tempRoot };
}

function cleanupTemp(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

async function run() {
  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const githubRepo = service.normalizeRepoConfig({
        owner: 'openai',
        name: 'skills.git',
        host: 'github.com',
        branch: 'main',
        directory: 'skills/.curated/'
      });
      assert.strictEqual(githubRepo.provider, 'github', 'GitHub provider 应自动推断');
      assert.strictEqual(githubRepo.host, 'https://github.com', 'GitHub host 应自动补全协议');
      assert.strictEqual(githubRepo.name, 'skills', 'GitHub repo name 应移除 .git 后缀');
      assert.strictEqual(githubRepo.directory, 'skills/.curated', 'GitHub directory 应去除首尾斜杠');
      assert.strictEqual(githubRepo.id, 'github:https://github.com::openai/skills::main::skills/.curated', 'GitHub repo id 不正确');

      const gitlabRepo = service.normalizeRepoConfig({
        provider: 'gitlab',
        host: 'gitlab.example.com',
        projectPath: 'team/subgroup/skills-repo',
        branch: 'main',
        directory: 'skills'
      });
      assert.strictEqual(gitlabRepo.provider, 'gitlab', 'GitLab provider 应被保留');
      assert.strictEqual(gitlabRepo.host, 'https://gitlab.example.com', 'GitLab host 应自动补全协议');
      assert.strictEqual(gitlabRepo.projectPath, 'team/subgroup/skills-repo', 'GitLab projectPath 应保留完整 namespace');
      assert.strictEqual(gitlabRepo.id, 'gitlab:https://gitlab.example.com::team/subgroup/skills-repo::main::skills', 'GitLab repo id 不正确');

      const inferredGitLabRepo = service.normalizeRepoConfig({
        projectPath: 'team/subgroup/skills-repo',
        branch: 'main'
      });
      assert.strictEqual(inferredGitLabRepo.provider, 'gitlab', '带 projectPath 时应自动推断 GitLab provider');
      assert.strictEqual(inferredGitLabRepo.host, 'https://gitlab.com', 'GitLab host 应回退为官方默认地址');

      const localRepo = service.normalizeRepoConfig({
        provider: 'local',
        localPath: tempRoot,
        branch: 'main',
        directory: 'skills'
      });
      assert.strictEqual(localRepo.provider, 'local', '本地 provider 应被保留');
      assert.strictEqual(localRepo.localPath, tempRoot, '本地路径应被规范化');

      const inferredLocalRepo = service.normalizeRepoConfig({
        localPath: tempRoot,
        branch: 'main'
      });
      assert.strictEqual(inferredLocalRepo.provider, 'local', '带 localPath 时应自动推断 local provider');
      assert.strictEqual(inferredLocalRepo.localPath, tempRoot, 'localPath 应被正确解析');

      const fileUrlLocalRepo = service.normalizeRepoConfig({
        provider: 'local',
        url: `file://${tempRoot}`,
        branch: 'main'
      });
      assert.strictEqual(fileUrlLocalRepo.localPath, tempRoot, 'file:// 本地路径应被正确解析');

      const originalGithubToken = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;
      service.getTokenFromConfigFile = () => null;
      service.getTokenFromCommand = (command, args) => (
        command === 'gh' && args.includes('--hostname') ? 'gh-host-token' : null
      );
      service.getTokenFromGitCredential = () => 'git-credential-token';
      assert.strictEqual(
        service.getGitHubToken('https://github.example.com'),
        'gh-host-token',
        'GitHub token 应优先回退到 gh CLI 认证'
      );
      service.clearCache();

      service.getTokenFromCommand = () => null;
      assert.strictEqual(
        service.getGitHubToken('https://github.example.com'),
        'git-credential-token',
        'GitHub token 在 CLI 不可用时应回退到 git credential'
      );

      service.getTokenFromCommand = (command, args) => (
        command === 'glab' && args.includes('--hostname') ? 'glab-host-token' : null
      );
      service.getTokenFromGitCredential = () => 'gitlab-credential-token';
      assert.strictEqual(
        service.getGitLabToken('https://gitlab.example.com'),
        'glab-host-token',
        'GitLab token 应优先回退到 glab CLI 认证'
      );
      service.clearCache();

      service.getTokenFromCommand = () => null;
      assert.strictEqual(
        service.getGitLabToken('https://gitlab.example.com'),
        'gitlab-credential-token',
        'GitLab token 在 CLI 不可用时应回退到 git credential'
      );
      if (originalGithubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalGithubToken;
      }

      const githubRepos = service.addRepo({
        provider: 'github',
        host: 'github.example.com',
        owner: 'secure-owner',
        name: 'secure-repo',
        branch: 'main',
        token: 'repo-github-token'
      });
      const storedGitHubRepo = githubRepos[0];
      assert.strictEqual(
        service.getGitHubToken({
          id: storedGitHubRepo.id,
          provider: storedGitHubRepo.provider,
          host: storedGitHubRepo.host,
          owner: storedGitHubRepo.owner,
          name: storedGitHubRepo.name,
          branch: storedGitHubRepo.branch
        }),
        'repo-github-token',
        'GitHub 仓库级 token 应优先于全局回退链路'
      );

      const gitlabRepos = service.addRepo({
        provider: 'gitlab',
        host: 'gitlab.example.com',
        projectPath: 'team/subgroup/skills-repo',
        branch: 'main',
        token: 'repo-gitlab-token'
      });
      const storedGitLabRepo = gitlabRepos.find((item) => item.provider === 'gitlab');
      assert.strictEqual(
        service.getGitLabToken({
          id: storedGitLabRepo.id,
          provider: storedGitLabRepo.provider,
          host: storedGitLabRepo.host,
          projectPath: storedGitLabRepo.projectPath,
          branch: storedGitLabRepo.branch
        }),
        'repo-gitlab-token',
        'GitLab 仓库级 token 应优先于全局回退链路'
      );
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      service.fetchSkillFileContent = async () => `---
name: "repo-root-skill"
description: "Root skill"
---

root content
`;
      const repo = service.normalizeRepoConfig({
        provider: 'github',
        owner: 'example',
        name: 'skills',
        branch: 'main'
      });
      const skill = await service.fetchAndParseSkill({ path: 'SKILL.md', sha: 'sha-root' }, repo, '');
      assert(skill, '根目录 SKILL.md 应被解析');
      assert.strictEqual(skill.directory, 'skills', '根目录 skill 应回退到仓库名作为目录');
      assert.strictEqual(skill.name, 'repo-root-skill', '根目录 skill 名称解析失败');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const localRepoRoot = path.join(tempRoot, 'gitlab-local-skills');
      const localSkillDir = path.join(localRepoRoot, 'skills', 'example-skill');
      fs.mkdirSync(localSkillDir, { recursive: true });
      fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), `---
name: "example-skill"
description: "Example local skill"
---

local content
`, 'utf-8');

      const repo = service.normalizeRepoConfig({
        provider: 'local',
        localPath: localRepoRoot,
        branch: 'main',
        directory: 'skills'
      });

      const skills = await service.fetchLocalRepoSkills(repo);
      assert.strictEqual(skills.length, 1, '本地仓库应扫描到一个 skill');
      assert.strictEqual(skills[0].directory, 'example-skill', '本地仓库 skill 目录应相对 directory 计算');
      assert.strictEqual(skills[0].repoProvider, 'local', '本地仓库来源应标记为 local');
      assert.strictEqual(skills[0].readmeUrl, null, '本地仓库 skill 不应暴露文件系统路径作为链接');
      service.loadRepos = () => [repo];
      const refresh = await service.refreshRemoteSkills({ platform: 'claude', scope: 'user' });
      assert.strictEqual(refresh.fetchedSkills, 1, '本地仓库刷新应发布完整 artifact');


      const detail = await service.getSkillDetail('example-skill', repo, 'skills/example-skill');
      assert.strictEqual(detail.source, 'local-repo', '本地仓库详情来源应为 local-repo');
      assert.strictEqual(detail.name, 'example-skill', '本地仓库详情名称不正确');
      assert.strictEqual(detail.content.includes('local content'), true, '本地仓库详情正文应可读取');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const skills = [
        { directory: 'shared-skill', repoId: 'repo-a', installed: false },
        { directory: 'shared-skill', repoId: 'repo-a', installed: false },
        { directory: 'group-a/shared-skill', repoId: 'repo-a', installed: false },
        { directory: 'group-b/shared-skill', repoId: 'repo-b', installed: false }
      ];
      service.deduplicateSkills(skills);
      assert.strictEqual(skills.length, 3, '去重后应保留不同 repo 技能，并移除完全重复项');
      assert.strictEqual(skills.filter(skill => skill.directory === 'shared-skill').length, 1, '完全重复的 skill 应仅保留一份');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const localRepoRoot = path.join(tempRoot, 'importable-local-skills');
      const localSkillDir = path.join(localRepoRoot, 'skills', 'example-skill');
      fs.mkdirSync(localSkillDir, { recursive: true });
      fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), `---
name: "example-skill"
description: "Example local skill"
---

local content
`, 'utf-8');
      fs.writeFileSync(path.join(localSkillDir, 'notes.txt'), 'extra file', 'utf-8');

      const repo = service.normalizeRepoConfig({
        provider: 'local',
        localPath: localRepoRoot,
        branch: 'main',
        directory: 'skills'
      });

      service.addRepo(repo);
      const refresh = await service.refreshRemoteSkills({ platform: 'claude', scope: 'user' });
      assert.strictEqual(refresh.fetchedSkills, 1, '保存本地仓库后需通过显式刷新发布 artifact');
      const listedSkills = (await service.scanSkills({ scope: 'user' })).skills;
      assert.strictEqual(listedSkills.length, 1, '刷新后总列表应扫描到 skill');
      assert.strictEqual(listedSkills[0].directory, 'example-skill', '总列表中的本地 skill 目录应正确');
      assert.strictEqual(listedSkills[0].repoProvider, 'local', '总列表中的 skill 应保留 local provider');

      const skill = listedSkills[0];
      service.controlService.setSkillTrust({ controlKey: skill.controlKey, scope: 'user', trust: 'approved' });
      const enabled = service.controlService.setSkillEnabled({
        controlKey: skill.controlKey,
        scope: 'user',
        enabled: true
      });
      assert.strictEqual(enabled.enabled, true, '批准后应能启用本地仓库 skill');
      assert.strictEqual(fs.existsSync(path.join(service.installDir, 'example-skill', 'SKILL.md')), true, '启用后应写入 SKILL.md');
      assert.strictEqual(fs.readFileSync(path.join(service.installDir, 'example-skill', 'notes.txt'), 'utf-8'), 'extra file', '启用后应复制附带文件');
      assert.strictEqual(service.isInstalled('example-skill'), true, '启用后应标记为已加载');

      const rescannedSkills = (await service.scanSkills({ scope: 'user' })).skills;
      assert.strictEqual(rescannedSkills.length, 1, `启用后重新扫描不应产生重复项: ${JSON.stringify(rescannedSkills)}`);
      assert.strictEqual(rescannedSkills[0].controlKey, skill.controlKey, 'projection 重新扫描应继续使用原始 controlKey');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: [] }), 'utf-8');
      const reposAfterAdd = service.addRepo({
        provider: 'gitlab',
        host: 'https://gitlab.example.com',
        projectPath: 'team/skills',
        branch: 'main'
      });
      assert.strictEqual(fs.existsSync(service.cachePath), false, '添加仓库后应清除磁盘缓存');

      const addedRepo = reposAfterAdd.find(repo => repo.provider === 'gitlab' && repo.projectPath === 'team/skills');
      assert(addedRepo, '应能找到刚添加的 GitLab repo');

      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: [] }), 'utf-8');
      service.toggleRepo('', '', '', false, addedRepo.id);
      assert.strictEqual(fs.existsSync(service.cachePath), false, '切换仓库状态后应清除磁盘缓存');

      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: [] }), 'utf-8');
      service.removeRepo('', '', '', addedRepo.id);
      assert.strictEqual(fs.existsSync(service.cachePath), false, '删除仓库后应清除磁盘缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const cachedSkills = [
        { name: 'cached-skill', directory: 'cached-skill', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      service.saveRepos([
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'openai',
          name: 'skills',
          branch: 'main',
          directory: 'skills/.curated',
          enabled: true
        })
      ]);

      service.skillsCache = [];
      service.fetchRepoSkills = async () => {
        throw new Error('GitHub API error: 403');
      };

      const listedSkills = await service.listSkills();
      assert.strictEqual(listedSkills.length, 1, '远端失败且内存缓存为空时应回退到磁盘缓存');
      assert.strictEqual(listedSkills[0].directory, 'cached-skill', '回退到磁盘缓存后的 skill 不正确');

      const diskCache = JSON.parse(fs.readFileSync(service.cachePath, 'utf-8'));
      assert.strictEqual(diskCache.skills.length, 1, '远端失败时不应把磁盘缓存覆盖为空');
      assert.strictEqual(diskCache.skills[0].directory, 'cached-skill', '磁盘缓存内容应保持不变');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const diskSkills = [
        { name: 'disk-skill-a', directory: 'disk-skill-a', installed: false },
        { name: 'disk-skill-b', directory: 'disk-skill-b', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: diskSkills }), 'utf-8');
      service.skillsCache = [
        { name: 'memory-skill', directory: 'memory-skill', installed: false }
      ];

      const listedSkills = await service.listSkills();
      assert.strictEqual(listedSkills.length, 2, '内存缓存不全时应优先使用更完整的磁盘缓存');
      assert.strictEqual(listedSkills[0].directory, 'disk-skill-a', '磁盘缓存回退结果不正确');
      assert.strictEqual(listedSkills[1].directory, 'disk-skill-b', '磁盘缓存回退结果不完整');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const localSkillDir = path.join(service.storageDir, 'uploaded-skill');
      fs.mkdirSync(localSkillDir, { recursive: true });
      fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), `---
name: "uploaded-skill"
description: "Uploaded local skill"
---

local uploaded content
`, 'utf-8');

      const cachedSkills = [
        { name: 'cached-skill', directory: 'cached-skill', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      service.skillsCache = [];

      const listedSkills = await service.listSkills();
      assert.strictEqual(listedSkills.length, 2, '回退到磁盘缓存时也应合并本地上传的 skills');
      assert.strictEqual(listedSkills.some(skill => skill.directory === 'cached-skill'), true, '磁盘缓存中的 skill 不应丢失');
      assert.strictEqual(listedSkills.some(skill => skill.directory === 'uploaded-skill'), true, '本地上传的 skill 应始终被加载');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const cachedSkills = [
        { name: 'stale-skill', directory: 'stale-skill', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      service.saveRepos([
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'openai',
          name: 'skills',
          branch: 'main',
          directory: 'skills/.curated',
          enabled: true
        })
      ]);

      service.fetchRepoSkills = async () => {
        throw new Error('GitHub API error: 403');
      };

      const listedSkills = await service.listSkills(true);
      assert.strictEqual(listedSkills.length, 1, '强制刷新且远端失败时应回退到磁盘缓存');
      assert.strictEqual(listedSkills[0].directory, 'stale-skill', '强制刷新回退后的磁盘缓存 skill 不正确');

      const diskCache = JSON.parse(fs.readFileSync(service.cachePath, 'utf-8'));
      assert.strictEqual(diskCache.skills.length, 1, '强制刷新失败时不应删除已有磁盘缓存');
      assert.strictEqual(diskCache.skills[0].directory, 'stale-skill', '强制刷新失败后应保留原磁盘缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const cachedSkills = [
        { name: 'cached-skill-a', directory: 'cached-skill-a', installed: false },
        { name: 'cached-skill-b', directory: 'cached-skill-b', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      service.saveRepos([
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'openai',
          name: 'skills',
          branch: 'main',
          directory: 'skills/.curated',
          enabled: true
        }),
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'tanweai',
          name: 'pua',
          branch: 'main',
          enabled: true
        })
      ]);

      service.fetchRepoSkills = async (repo) => {
        if (repo.owner === 'openai') {
          return [{ name: 'partial-skill', directory: 'partial-skill', installed: false }];
        }
        throw new Error('GitHub API error: 403');
      };

      const listedSkills = await service.listSkills(true);
      assert.strictEqual(listedSkills.length, 2, '部分仓库拉取失败且结果不完整时应回退到更完整的磁盘缓存');
      assert.strictEqual(listedSkills[0].directory, 'cached-skill-a', '部分失败场景下的磁盘缓存回退结果不正确');
      assert.strictEqual(listedSkills[1].directory, 'cached-skill-b', '部分失败场景下应保留完整磁盘缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const cachedSkills = [
        { name: 'omp-cached-skill', directory: 'omp-cached-skill', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      service.saveRepos([
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'example',
          name: 'omp-skills',
          branch: 'main',
          enabled: true
        })
      ]);
      let prepareCalls = 0;
      service.prepareSkills = skills => {
        prepareCalls++;
        return skills.map(skill => ({ ...skill }));
      };

      let remoteCalls = 0;
      service.fetchRepoSkills = async () => {
        remoteCalls++;
        throw new Error('network unavailable');
      };

      const listedSkills = await service.listSkills();
      const cachedSkillsAgain = await service.listSkills();
      fs.mkdirSync(path.join(tempRoot, 'project-b'), { recursive: true });
      const otherCwdSkills = await service.listSkills(false, { cwd: path.join(tempRoot, 'project-b') });
      assert.deepStrictEqual(otherCwdSkills, listedSkills, '不同项目上下文应复用远程缓存但重新准备列表');

      assert.deepStrictEqual(listedSkills.map(skill => skill.directory), ['omp-cached-skill'], 'OMP 普通请求应优先返回磁盘缓存');
      assert.deepStrictEqual(cachedSkillsAgain, listedSkills, 'OMP 缓存命中结果应保持一致');
      assert.strictEqual(remoteCalls, 0, 'OMP 缓存命中时不应请求远程仓库');
      assert.strictEqual(prepareCalls, 3, '每次本地扫描应在各上下文准备独立列表');
    } finally {
      cleanupTemp(tempRoot);
    }
  }
  {
    const { service, tempRoot } = createTempSkillService('omp');
    service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
    try {
      const cachedSkills = [
        { name: 'omp-cached-skill', directory: 'omp-cached-skill', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      service.saveRepos([
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'example',
          name: 'omp-skills',
          branch: 'main',
          enabled: true
        })
      ]);
      let remoteCalls = 0;
      service.fetchRepoSkills = async () => {
        remoteCalls++;
        throw new Error('network must be manual');
      };

      const listedSkills = await service.listSkills(true);
      const cachedSkillsAgain = await service.listSkills();
      assert.deepStrictEqual(listedSkills.map(skill => skill.directory), ['omp-cached-skill'], 'OMP 本地扫描应优先返回磁盘缓存');
      assert.deepStrictEqual(cachedSkillsAgain, listedSkills, '重复本地扫描结果应保持一致');
      assert.strictEqual(remoteCalls, 0, '打开 OMP 列表不得请求远程仓库');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
    try {
      const repoRoot = path.join(tempRoot, 'omp-local-repo');
      const skillDir = path.join(repoRoot, 'skills', 'explicit-skill');
      fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: explicit-skill\n---\nOMP body');
      fs.writeFileSync(path.join(skillDir, 'scripts', 'helper.sh'), '#!/bin/sh\ntrue');
      const repo = service.normalizeRepoConfig({
        provider: 'local',
        localPath: repoRoot,
        directory: 'skills',
        branch: 'main',
        enabled: true
      });
      service.saveRepos([repo]);
      const taskService = new SkillRefreshTaskService({
        persistencePath: path.join(tempRoot, 'refresh-tasks.json'),
        worker: context => service.refreshRemoteSkills(context)
      });
      const firstTask = taskService.enqueue({ platform: 'omp', scope: 'user', reason: 'manual' });
      const duplicateTask = taskService.enqueue({ platform: 'omp', scope: 'user', reason: 'manual' });
      assert.strictEqual(duplicateTask.id, firstTask.id, '同一刷新键应复用活动 task');
      const completed = await taskService.waitFor(firstTask.id);
      assert.strictEqual(completed.status, 'succeeded', '显式 OMP refresh 应完成');

      const listed = (await service.scanSkills({ scope: 'user' })).skills;
      const skill = listed.find(item => item.directory === 'explicit-skill');
      assert(skill, '显式刷新后应扫描到 OMP Skill');
      assert.strictEqual(skill.cached, true, '显式刷新后 Skill 应有完整缓存');
      assert.strictEqual(skill.trust, 'needs_review', '新 Skill 应需要复审');
      assert.strictEqual(skill.enabled, false, '新 Skill 默认关闭');

      service.controlService.setSkillTrust({ controlKey: skill.controlKey, scope: 'user', trust: 'approved' });
      const enabled = service.controlService.setSkillEnabled({ controlKey: skill.controlKey, scope: 'user', enabled: true });
      assert.strictEqual(enabled.enabled, true, JSON.stringify(enabled));
      assert.strictEqual(fs.existsSync(path.join(service.installDir, 'explicit-skill', 'scripts', 'helper.sh')), true);
      service.controlService.setSkillEnabled({ controlKey: skill.controlKey, scope: 'user', enabled: false });
      assert.strictEqual(fs.existsSync(skill.artifact.root), true, '关闭不得删除 OMP artifact');
      assert.strictEqual(fs.existsSync(path.join(service.installDir, 'explicit-skill')), false);
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const projectDir = path.join(tempRoot, 'project');
      const userSkill = path.join(service.installDir, 'shared');
      const projectSkill = path.join(projectDir, '.claude', 'skills', 'shared');
      fs.mkdirSync(userSkill, { recursive: true });
      fs.mkdirSync(projectSkill, { recursive: true });
      fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '---\nname: shared\n---\nUser');
      fs.writeFileSync(path.join(projectSkill, 'SKILL.md'), '---\nname: shared\n---\nProject');

      const projectSkills = (await service.scanSkills({ scope: 'project', cwd: projectDir })).skills;
      const shared = projectSkills.find(skill => skill.directory === 'shared');
      assert(shared, 'project scan 应发现项目 Skill');
      assert.strictEqual(shared.sourceScope, 'project', 'project Skill 应优先于 user Skill');
      assert(shared.shadowedSources.some(source => source.sourceScope === 'user'), 'user Skill 应作为 shadowed source');
      assert.strictEqual(fs.existsSync(path.join(userSkill, 'SKILL.md')), true, 'project scan 不得删除 user Skill');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const skills = [
        { name: 'remote-a', directory: 'remote-a', installed: false },
        { name: 'remote-b', directory: 'remote-b', installed: false }
      ];
      let refreshCalls = 0;
      service.refreshOmpPaths = () => {
        refreshCalls++;
      };
      service.updateInstallStatus(skills);
      assert.strictEqual(refreshCalls, 1, 'OMP 更新状态时应只解析一次动态路径');
      refreshCalls = 0;
      service.updateInstallStatus(skills, { pathsRefreshed: true });
      assert.strictEqual(refreshCalls, 0, '已解析路径时不应重复解析');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const previousToken = process.env.GITHUB_TOKEN;
      const previousGhToken = process.env.GH_TOKEN;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      try {
        service.getTokenFromConfigFile = () => null;
        service.getTokenFromCommand = () => null;
        let credentialCalls = 0;
        service.getTokenFromGitCredential = () => {
          credentialCalls++;
          return null;
        };
        service.getGitHubToken('https://github.example.com');
        service.getGitHubToken('https://github.example.com');
        assert.strictEqual(credentialCalls, 1, 'GitHub 凭证应按 host 缓存');
        process.env.GITHUB_TOKEN = 'env-token';
        assert.strictEqual(service.getGitHubToken('https://github.example.com'), 'env-token');
      } finally {
        if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = previousToken;
        if (previousGhToken === undefined) delete process.env.GH_TOKEN;
        else process.env.GH_TOKEN = previousGhToken;
      }
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      let receivedRepo = null;
      service.fetchGitHubApi = async (_url, repo) => {
        receivedRepo = repo;
        return { content: Buffer.from('skill-content', 'utf-8').toString('base64') };
      };
      const repo = service.normalizeRepoConfig({
        provider: 'github',
        owner: 'example',
        name: 'skills',
        branch: 'main'
      });
      const content = await service.fetchGitHubBlobContent('sha', repo);
      assert.strictEqual(content, 'skill-content', 'GitHub Blob 内容应正确解码');
      assert.strictEqual(receivedRepo, repo, 'GitHub Blob 请求应传递仓库上下文');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService();
    try {
      const sourceRoot = path.join(tempRoot, 'unsafe-source');
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.symlinkSync('/etc/hosts', path.join(sourceRoot, 'SKILL.md'));
      const result = await service.fetchLocalRepoSkills({
        provider: 'local',
        localPath: sourceRoot,
        directory: ''
      });
      assert.strictEqual(result.length, 0, '符号链接 Skill 不应进入本地扫描');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  console.log('skills provider 测试通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
