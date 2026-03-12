const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'src/web/src/utils/skill-repo-input.js')
  ).href;
  const { parseRepoInput } = await import(moduleUrl);

  const githubTreeRepo = parseRepoInput('https://github.com/openai/skills/tree/main/skills/.curated');
  assert.deepStrictEqual(githubTreeRepo, {
    provider: 'github',
    host: 'https://github.com',
    owner: 'openai',
    name: 'skills',
    branch: 'main',
    directory: 'skills/.curated'
  }, 'GitHub tree URL 应解析出 owner/name/branch/directory');

  const gitlabTreeRepo = parseRepoInput('https://gitlab.example.com/team/subgroup/skills-repo/-/tree/main/skills');
  assert.deepStrictEqual(gitlabTreeRepo, {
    provider: 'gitlab',
    host: 'https://gitlab.example.com',
    projectPath: 'team/subgroup/skills-repo',
    branch: 'main',
    directory: 'skills'
  }, 'GitLab tree URL 应解析出 projectPath/branch/directory');

  const githubBlobRepo = parseRepoInput('https://github.com/openai/skills/blob/main/skills/.curated/example/SKILL.md');
  assert.deepStrictEqual(githubBlobRepo, {
    provider: 'github',
    host: 'https://github.com',
    owner: 'openai',
    name: 'skills',
    branch: 'main',
    directory: 'skills/.curated/example'
  }, 'GitHub blob URL 应回退到所在目录');

  console.log('skill repo input 测试通过');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
