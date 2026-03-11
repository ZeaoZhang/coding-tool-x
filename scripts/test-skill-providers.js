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

  console.log('skills provider 测试通过');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
