const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SkillService } = require('../src/server/services/skill-service');

function createTempSkillService(platform = 'claude') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-skill-test-'));
  const service = new SkillService(platform);
  service.configDir = path.join(tempRoot, 'config');
  service.installDir = path.join(tempRoot, 'install');
  service.storageDir = path.join(service.configDir, 'storage');
  service.reposConfigPath = path.join(service.configDir, 'repos.json');
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
      const listedSkills = await service.listSkills(true);
      assert.strictEqual(listedSkills.length, 1, '添加本地仓库后应能从总列表扫描到 skill');
      assert.strictEqual(listedSkills[0].directory, 'example-skill', '总列表中的本地 skill 目录应正确');
      assert.strictEqual(listedSkills[0].repoProvider, 'local', '总列表中的 skill 应保留 local provider');

      const installResult = await service.installSkill('example-skill', repo, 'skills/example-skill');
      assert.strictEqual(installResult.success, true, '本地仓库 skill 应可安装');
      assert.strictEqual(fs.existsSync(path.join(service.installDir, 'example-skill', 'SKILL.md')), true, '安装后应写入 SKILL.md');
      assert.strictEqual(fs.readFileSync(path.join(service.installDir, 'example-skill', 'notes.txt'), 'utf-8'), 'extra file', '安装后应复制附带文件');
      assert.strictEqual(service.isInstalled('example-skill'), true, '安装后应标记为已安装');

      const rescannedSkills = await service.listSkills(true);
      assert.strictEqual(rescannedSkills.length, 1, '安装后重新扫描不应产生重复项');
      assert.strictEqual(rescannedSkills[0].installed, true, '安装后总列表中的 skill 应显示为已安装');
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
      const otherCwdSkills = await service.listSkills(false, { cwd: path.join(tempRoot, 'project-b') });
      assert.deepStrictEqual(otherCwdSkills, listedSkills, '不同项目上下文应复用远程缓存但重新准备列表');

      assert.deepStrictEqual(listedSkills.map(skill => skill.directory), ['omp-cached-skill'], 'OMP 普通请求应优先返回磁盘缓存');
      assert.deepStrictEqual(cachedSkillsAgain, listedSkills, 'OMP 缓存命中结果应保持一致');
      assert.strictEqual(remoteCalls, 0, 'OMP 缓存命中时不应请求远程仓库');
      assert.strictEqual(prepareCalls, 2, '不同项目上下文不应复用同一份准备缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const cachedSkills = [
        { name: 'omp-stale-skill', directory: 'omp-stale-skill', installed: false }
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
      service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
      service.fetchRepoSkills = async () => {
        throw new Error('network unavailable');
      };

      const listedSkills = await service.listSkills(true);
      assert.deepStrictEqual(listedSkills.map(skill => skill.directory), ['omp-stale-skill'], 'OMP 强制刷新失败时应回退到旧缓存');
      const diskCache = JSON.parse(fs.readFileSync(service.cachePath, 'utf-8'));
      assert.deepStrictEqual(diskCache.skills.map(skill => skill.directory), ['omp-stale-skill'], 'OMP 刷新失败不应覆盖磁盘缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      service.saveRepos([
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'example',
          name: 'omp-skills',
          branch: 'main',
          enabled: true
        })
      ]);
      service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
      let resolveRemote;
      const remoteResult = new Promise(resolve => {
        resolveRemote = resolve;
      });
      let remoteCalls = 0;
      service.fetchRepoSkills = async () => {
        remoteCalls++;
        return remoteResult;
      };

      const firstRequest = service.listSkills(true);
      const secondRequest = service.listSkills(true);
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(remoteCalls, 1, '并发 OMP 刷新应共享同一个远程请求');
      resolveRemote([{ name: 'shared-remote-skill', directory: 'shared-remote-skill', installed: false }]);
      const [firstSkills, secondSkills] = await Promise.all([firstRequest, secondRequest]);
      assert.deepStrictEqual(firstSkills, secondSkills, '共享远程请求的并发结果应一致');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      service.saveRepos([
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'example',
          name: 'omp-skills',
          branch: 'main',
          enabled: true
        })
      ]);
      service.ompRemoteRefreshTimeoutMs = 10;
      service.prepareSkills = skills => [
        ...skills,
        { name: 'omp-local-skill', directory: 'omp-local-skill', installed: true }
      ];
      let remoteCalls = 0;
      service.fetchRepoSkills = () => {
        remoteCalls++;
        return new Promise(() => {});
      };

      const started = Date.now();
      const listedSkills = await service.listSkills(true);
      const elapsed = Date.now() - started;
      assert(elapsed < 1500, `OMP 远程超时时应快速返回，实际耗时 ${elapsed}ms`);
      assert.deepStrictEqual(listedSkills.map(skill => skill.directory), ['omp-local-skill'], 'OMP 冷启动断网应返回本地 fallback');

      const secondStarted = Date.now();
      const secondSkills = await service.listSkills();
      const secondElapsed = Date.now() - secondStarted;
      assert(secondElapsed < 500, `OMP 断网 fallback 后普通请求应快速返回，实际耗时 ${secondElapsed}ms`);
      assert.deepStrictEqual(secondSkills, listedSkills, 'OMP 断网 fallback 后普通请求结果应保持一致');
      assert.strictEqual(remoteCalls, 1, 'OMP 断网 fallback 后普通请求不应重复请求远程仓库');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      service.saveRepos([
        service.normalizeRepoConfig({
          provider: 'github',
          owner: 'example',
          name: 'omp-skills',
          branch: 'main',
          enabled: true
        })
      ]);
      service.ompRemoteRefreshTimeoutMs = 10;
      service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
      let resolveRemote;
      service.fetchRepoSkills = () => new Promise(resolve => {
        resolveRemote = resolve;
      });

      const firstSkills = await service.listSkills(true);
      const pendingRefresh = service.ompRemoteRefreshPromise;
      assert.deepStrictEqual(firstSkills, [], '远程超时时首次结果应使用空远程 fallback');
      resolveRemote([{ name: 'eventual-skill', directory: 'eventual-skill', installed: false }]);
      await pendingRefresh;

      const secondSkills = await service.listSkills();
      assert.deepStrictEqual(
        secondSkills.map(skill => skill.directory),
        ['eventual-skill'],
        '后台远程刷新成功后普通请求应重新准备最新技能'
      );
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const cachedSkills = [
        { name: 'stale-skill', directory: 'stale-skill', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      const freshRepo = service.normalizeRepoConfig({
        provider: 'github',
        owner: 'fresh-owner',
        name: 'fresh-repo',
        branch: 'main',
        enabled: true
      });
      const offlineRepo = service.normalizeRepoConfig({
        provider: 'local',
        owner: 'offline-owner',
        name: 'offline-repo',
        branch: 'main',
        localPath: path.join(tempRoot, 'missing-local'),
        enabled: true
      });
      service.saveRepos([freshRepo, offlineRepo]);
      service.ompRemoteRefreshTimeoutMs = 10;
      service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
      let resolveFresh;
      service.fetchRepoSkills = async repo => {
        if (repo.owner === 'fresh-owner') {
          return new Promise(resolve => {
            resolveFresh = resolve;
          });
        }
        throw new Error('network unavailable');
      };

      const firstSkills = await service.listSkills(true);
      const pendingRefresh = service.ompRemoteRefreshPromise;
      assert.deepStrictEqual(firstSkills.map(skill => skill.directory), ['stale-skill'], '部分远程刷新超时时应先返回旧缓存');
      resolveFresh([{ name: 'fresh-skill', directory: 'fresh-skill', installed: false }]);
      await pendingRefresh;

      const secondSkills = await service.listSkills();
      assert.deepStrictEqual(
        secondSkills.map(skill => skill.directory),
        ['fresh-skill', 'stale-skill'],
        '后台部分刷新成功后普通请求应展示新结果并保留旧缓存'
      );
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const cachedSkills = [
        { name: 'invalidated-skill', directory: 'invalidated-skill', installed: false }
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
      service.ompRemoteRefreshTimeoutMs = 10;
      service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
      let refreshMode = 'pending';
      let remoteCalls = 0;
      service.fetchRepoSkills = () => {
        remoteCalls++;
        return refreshMode === 'pending'
          ? new Promise(() => {})
          : Promise.resolve([]);
      };

      const firstRequest = service.listSkills(true);
      await new Promise(resolve => setImmediate(resolve));
      service.clearCache({ removeFile: true });
      await firstRequest;
      refreshMode = 'resolved';
      const nextSkills = await service.listSkills();
      assert.deepStrictEqual(nextSkills, [], '失效刷新超时后不应返回旧的项目缓存');
      assert.strictEqual(remoteCalls, 2, '失效刷新超时后普通请求应使用新缓存世代');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      let prepareCalls = 0;
      service.prepareSkills = skills => {
        prepareCalls++;
        if (prepareCalls === 1) {
          service.ompRemoteRefreshGeneration++;
        }
        return skills;
      };

      const prepared = service.prepareAndCacheOmpSkills([
        { name: 'stale-path-skill', directory: 'stale-path-skill', installed: false }
      ]);
      assert.deepStrictEqual(prepared, [], '路径失效时应返回未缓存的当前本地准备结果');
      assert.strictEqual(service.ompPreparedSkillsCache, null, '路径失效时不应提交旧的准备缓存');
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
      assert.strictEqual(refreshCalls, 1, 'OMP 更新安装状态时应只解析一次动态安装路径');
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

      service.updateInstallStatus(skills, { pathsRefreshed: true });
      assert.strictEqual(refreshCalls, 0, 'OMP 已完成列表级路径解析后不应重复解析动态安装路径');
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
        assert.strictEqual(credentialCalls, 1, 'GitHub 全局凭证解析应按 host 缓存，避免每个 Blob 重复执行 git credential');
        process.env.GITHUB_TOKEN = 'env-token';
        assert.strictEqual(service.getGitHubToken('https://github.example.com'), 'env-token', '环境变量 Token 应覆盖已缓存的 git credential 结果');
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
        name: 'omp-skills',
        branch: 'main'
      });

      const content = await service.fetchGitHubBlobContent('sha', repo);
      assert.strictEqual(content, 'skill-content', 'GitHub Blob 内容应正确解码');
      assert.strictEqual(receivedRepo, repo, 'GitHub Blob 请求应传递仓库上下文以复用仓库凭证');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const repo = service.normalizeRepoConfig({
        provider: 'github',
        owner: 'example',
        name: 'omp-skills',
        branch: 'main',
        enabled: true
      });
      service.saveRepos([repo]);
      service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
      const resolvers = [];
      let remoteCalls = 0;
      service.fetchRepoSkills = () => {
        remoteCalls++;
        return new Promise(resolve => resolvers.push(resolve));
      };

      const firstRequest = service.listSkills(true);
      await new Promise(resolve => setImmediate(resolve));
      service.clearCache({ removeFile: true });
      service.saveRepos([repo]);
      const secondRequest = service.listSkills(true);
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(remoteCalls, 2, '仓库配置变更后不应复用旧的 OMP 远程刷新');

      resolvers[1]([{ name: 'new-skill', directory: 'new-skill', installed: false }]);
      const secondSkills = await secondRequest;
      resolvers[0]([{ name: 'old-skill', directory: 'old-skill', installed: false }]);
      await firstRequest;
      const afterRaceSkills = await service.listSkills();
      assert.deepStrictEqual(
        afterRaceSkills.map(skill => skill.directory),
        ['new-skill'],
        '失效刷新完成后普通请求不应返回旧的准备缓存'
      );
      assert.deepStrictEqual(secondSkills.map(skill => skill.directory), ['new-skill'], '新仓库刷新应返回新技能');
      assert.deepStrictEqual(
        service.ompRemoteSkillsCache.map(skill => skill.directory),
        ['new-skill'],
        '旧刷新结果不应覆盖新仓库的内存缓存'
      );
      const diskCache = JSON.parse(fs.readFileSync(service.cachePath, 'utf-8'));
      assert.deepStrictEqual(diskCache.skills.map(skill => skill.directory), ['new-skill'], '旧刷新结果不应覆盖仓库变更后的缓存');
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const cachedSkills = [
        { name: 'stale-skill', directory: 'stale-skill', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      const repoA = service.normalizeRepoConfig({
        provider: 'github',
        owner: 'fresh-owner',
        name: 'fresh-repo',
        branch: 'main',
        enabled: true
      });
      const repoB = service.normalizeRepoConfig({
        provider: 'github',
        owner: 'offline-owner',
        name: 'offline-repo',
        branch: 'main',
        enabled: true
      });
      service.saveRepos([repoA, repoB]);
      service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
      service.fetchRepoSkills = async repo => {
        if (repo.owner === 'fresh-owner') {
          return [{ name: 'fresh-skill', directory: 'fresh-skill', installed: false }];
        }
        throw new Error('network unavailable');
      };

      const listedSkills = await service.listSkills(true);
      assert.deepStrictEqual(
        listedSkills.map(skill => skill.directory),
        ['fresh-skill', 'stale-skill'],
        '部分远程仓库失败时应保留成功结果并合并旧缓存'
      );
    } finally {
      cleanupTemp(tempRoot);
    }
  }

  {
    const { service, tempRoot } = createTempSkillService('omp');
    try {
      const cachedSkills = [
        { name: 'stale-skill', directory: 'stale-skill', installed: false }
      ];
      fs.writeFileSync(service.cachePath, JSON.stringify({ time: Date.now(), skills: cachedSkills }), 'utf-8');
      const localRepo = service.normalizeRepoConfig({
        provider: 'local',
        localPath: path.join(tempRoot, 'missing-local'),
        enabled: true
      });
      service.saveRepos([localRepo]);
      service.prepareSkills = skills => skills.map(skill => ({ ...skill }));
      service.fetchRepoSkills = async () => {
        throw new Error('local repository unavailable');
      };

      const listedSkills = await service.listSkills(true);
      assert.deepStrictEqual(listedSkills.map(skill => skill.directory), ['stale-skill'], '本地仓库失败时应保留旧缓存');
      const diskCache = JSON.parse(fs.readFileSync(service.cachePath, 'utf-8'));
      assert.deepStrictEqual(diskCache.skills.map(skill => skill.directory), ['stale-skill'], '本地仓库失败时不应覆盖远程缓存');
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
