const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');
}

async function run() {
  const skillCard = read('src/web/src/components/SkillCard.vue');
  const detailModal = read('src/web/src/components/SkillDetailModal.vue');
  const helperUrl = pathToFileURL(
    path.join(__dirname, '..', 'src/web/src/utils/skill-source.js')
  ).href;
  const {
    canInstallSkill,
    formatSkillSourceText,
    getSkillSourceLink,
    getSkillSourceLocation,
    getSkillSourceTag
  } = await import(helperUrl);
  const localRepoSkill = {
    source: 'local-repo',
    repoProvider: 'local',
    repoLocalPath: '/Users/zhangzeao/workspace/sxf/ai_native/spec'
  };
  const githubSkill = {
    repoProvider: 'github',
    repoOwner: 'openai',
    repoName: 'skills',
    readmeUrl: 'https://github.com/openai/skills/tree/main/skills/.curated'
  };

  assert(
    skillCard.includes('canInstallSkill(skill)'),
    'SkillCard 应允许 local-repo skill 在 UI 中可安装'
  );

  assert(
    detailModal.includes('canInstallSkill(detail)'),
    'SkillDetailModal 应允许 local-repo skill 在详情弹窗中安装'
  );

  assert(
    detailModal.includes('repoLocalPath: result.repoLocalPath || props.skill?.repoLocalPath'),
    'SkillDetailModal 应保留 local-repo 的来源路径用于展示'
  );

  assert.strictEqual(canInstallSkill(localRepoSkill), true, 'local-repo skill 应可安装');
  assert.strictEqual(getSkillSourceTag(localRepoSkill), '本地仓库', 'local-repo skill 来源标签应为本地仓库');
  assert.strictEqual(
    getSkillSourceLocation(localRepoSkill),
    '/Users/zhangzeao/workspace/sxf/ai_native/spec',
    'local-repo skill 应展示本地仓库路径'
  );
  assert.strictEqual(getSkillSourceLink(localRepoSkill), null, 'local-repo skill 不应暴露可点击外链');
  assert.strictEqual(
    formatSkillSourceText(localRepoSkill),
    '本地仓库 · /Users/zhangzeao/workspace/sxf/ai_native/spec',
    'local-repo skill 来源文案应区分本地仓库'
  );

  assert.strictEqual(getSkillSourceTag(githubSkill), 'GitHub', 'GitHub skill 来源标签应为 GitHub');
  assert.strictEqual(
    getSkillSourceLink(githubSkill),
    'https://github.com/openai/skills/tree/main/skills/.curated',
    'GitHub skill 应保留外链'
  );

  console.log('skill UI regression 测试通过');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
