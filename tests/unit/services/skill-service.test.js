// globals: true in vitest.config.js

const os = require('os');
const fs = require('fs');
const path = require('path');

let testDir;

function stubPaths() {
  const p = require.resolve('../../../src/config/paths');
  require.cache[p] = {
    id: p,
    filename: p,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        claude:    { dir: path.join(testDir, 'native-claude'),   skills: path.join(testDir, 'claude-skills') },
        codex:     { dir: path.join(testDir, 'native-codex'),    skills: path.join(testDir, 'codex-skills') },
        gemini:    { dir: path.join(testDir, 'native-gemini'),   skills: path.join(testDir, 'gemini-skills') },
        opencode:  { dir: path.join(testDir, 'native-opencode'), config: path.join(testDir, 'opencode-config'), skills: path.join(testDir, 'opencode-skills') },
        pi: { dir: path.join(testDir, 'native-pi'), skills: path.join(testDir, 'native-pi', 'skills') }
      },
      HOME_DIR: testDir,
      PATHS: {
        base:   testDir,
        config: path.join(testDir, 'config'),
        localSkills: {
          claude:   path.join(testDir, 'local', 'claude'),
          codex:    path.join(testDir, 'local', 'codex'),
          gemini:   path.join(testDir, 'local', 'gemini'),
          opencode: path.join(testDir, 'local', 'opencode'),
          pi: path.join(testDir, 'local', 'pi')
        },
        skillRepos: {
          claude:   path.join(testDir, 'repos', 'claude.json'),
          codex:    path.join(testDir, 'repos', 'codex.json'),
          gemini:   path.join(testDir, 'repos', 'gemini.json'),
          opencode: path.join(testDir, 'repos', 'opencode.json'),
          pi: path.join(testDir, 'repos', 'pi.json')
        },
        skillCaches: {
          claude:   path.join(testDir, 'cache', 'claude.json'),
          codex:    path.join(testDir, 'cache', 'codex.json'),
          gemini:   path.join(testDir, 'cache', 'gemini.json'),
          opencode: path.join(testDir, 'cache', 'opencode.json'),
          pi: path.join(testDir, 'cache', 'pi.json')
        }
      }
    }
  };
}

function stubFormatConverter() {
  const fc = require.resolve('../../../src/server/services/format-converter');
  require.cache[fc] = {
    id: fc,
    filename: fc,
    loaded: true,
    exports: {
      parseSkillContent: vi.fn((c, options = {}) => {
        const nameMatch = String(c || '').match(/^name:\s*(.+)$/m);
        const descriptionMatch = String(c || '').match(/^description:\s*(.+)$/m);
        return {
          name: nameMatch ? nameMatch[1].replace(/^["']|["']$/g, '') : 'test',
          description: descriptionMatch ? descriptionMatch[1].replace(/^["']|["']$/g, '') : 'desc',
          body: c,
          format: options.platform === 'codex' ? 'codex' : 'claude'
        };
      })
    }
  };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-svc-'));
  stubPaths();
  stubFormatConverter();
  delete require.cache[require.resolve('../../../src/server/services/skill-service')];
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete require.cache[require.resolve('../../../src/server/services/skill-service')];
  delete require.cache[require.resolve('../../../src/config/paths')];
  try {
    delete require.cache[require.resolve('../../../src/server/services/format-converter')];
  } catch (_) {}
});

describe('skill-service constants', () => {
  it('DEFAULT_REPOS_BY_PLATFORM has all managed platform keys', () => {
    const { DEFAULT_REPOS_BY_PLATFORM } = require('../../../src/server/services/skill-service');
    expect(DEFAULT_REPOS_BY_PLATFORM).toHaveProperty('claude');
    expect(DEFAULT_REPOS_BY_PLATFORM).toHaveProperty('codex');
    expect(DEFAULT_REPOS_BY_PLATFORM).toHaveProperty('gemini');
    expect(DEFAULT_REPOS_BY_PLATFORM).toHaveProperty('opencode');
    expect(DEFAULT_REPOS_BY_PLATFORM).toHaveProperty('pi');
  });

  it('each platform entry is an array', () => {
    const { DEFAULT_REPOS_BY_PLATFORM } = require('../../../src/server/services/skill-service');
    for (const platform of ['claude', 'codex', 'gemini', 'opencode', 'pi']) {
      expect(Array.isArray(DEFAULT_REPOS_BY_PLATFORM[platform])).toBe(true);
    }
  });

  it('each default repo has owner and name fields', () => {
    const { DEFAULT_REPOS_BY_PLATFORM } = require('../../../src/server/services/skill-service');
    for (const repos of Object.values(DEFAULT_REPOS_BY_PLATFORM)) {
      for (const repo of repos) {
        expect(typeof repo.owner).toBe('string');
        expect(repo.owner.length).toBeGreaterThan(0);
        expect(typeof repo.name).toBe('string');
        expect(repo.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('claude default repos is currently empty', () => {
    const { DEFAULT_REPOS_BY_PLATFORM } = require('../../../src/server/services/skill-service');
    expect(DEFAULT_REPOS_BY_PLATFORM.claude).toEqual([]);
  });

  it('DEFAULT_REPOS equals DEFAULT_REPOS_BY_PLATFORM.claude', () => {
    const { DEFAULT_REPOS, DEFAULT_REPOS_BY_PLATFORM } = require('../../../src/server/services/skill-service');
    expect(DEFAULT_REPOS).toBe(DEFAULT_REPOS_BY_PLATFORM.claude);
  });
});

describe('SkillService constructor', () => {
  it('defaults to platform claude when no argument given', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService();
    expect(svc.platform).toBe('claude');
  });

  it('sets platform to codex when passed codex', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('codex');
    expect(svc.platform).toBe('codex');
  });

  it('sets platform to gemini when passed gemini', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('gemini');
    expect(svc.platform).toBe('gemini');
  });

  it('sets platform to pi when passed pi', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('pi');
    expect(svc.platform).toBe('pi');
  });

  it('sets platform to opencode when passed opencode', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('opencode');
    expect(svc.platform).toBe('opencode');
  });

  it('falls back to claude for an invalid platform string', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('invalid-platform');
    expect(svc.platform).toBe('claude');
  });

  it('falls back to claude for empty string platform', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('');
    expect(svc.platform).toBe('claude');
  });
});

describe('SkillService.getRepos / addRepo / removeRepo', () => {
  it('loadRepos returns array even when no config file exists', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const repos = svc.loadRepos();
    expect(Array.isArray(repos)).toBe(true);
    expect(repos).toEqual([]);
  });

  it('addRepo adds a new repo and returns updated list', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const before = svc.loadRepos().length;
    const updated = svc.addRepo({ owner: 'test-owner', name: 'test-repo', branch: 'main', directory: '', enabled: true });
    expect(Array.isArray(updated)).toBe(true);
    expect(updated.length).toBe(before + 1);
    expect(updated.some(r => r.owner === 'test-owner' && r.name === 'test-repo')).toBe(true);
  });

  it('addRepo updates existing repo instead of duplicating when id matches', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    svc.addRepo({ owner: 'test-owner', name: 'test-repo', branch: 'main', directory: '', enabled: true });
    const after1 = svc.loadRepos().length;
    // Add same repo again - should update, not duplicate
    svc.addRepo({ owner: 'test-owner', name: 'test-repo', branch: 'main', directory: '', enabled: false });
    const after2 = svc.loadRepos().length;
    expect(after2).toBe(after1);
  });

  it('removeRepo removes a repo by owner and name', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    svc.addRepo({ owner: 'rm-owner', name: 'rm-repo', branch: 'main', directory: '', enabled: true });
    const beforeRemove = svc.loadRepos().length;
    const updated = svc.removeRepo('rm-owner', 'rm-repo');
    expect(Array.isArray(updated)).toBe(true);
    expect(updated.length).toBe(beforeRemove - 1);
    expect(updated.some(r => r.owner === 'rm-owner' && r.name === 'rm-repo')).toBe(false);
  });

  it('removeRepo is a no-op when repo does not exist', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const before = svc.loadRepos().length;
    const updated = svc.removeRepo('nobody', 'nothing');
    expect(updated.length).toBe(before);
  });
});

describe('SkillService repo auth', () => {
  it('getReposForClient masks repo tokens', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    svc.addRepo({
      owner: 'secure-owner',
      name: 'secure-repo',
      branch: 'main',
      token: 'secret-token'
    });

    const repos = svc.getReposForClient();

    expect(repos).toHaveLength(1);
    expect(repos[0].token).toBeUndefined();
    expect(repos[0].hasToken).toBe(true);
    expect(repos[0].tokenPreview).toBe('secr...oken');
  });

  it('prefers stored GitHub repo token over global fallbacks when repo id matches', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const repos = svc.addRepo({
      provider: 'github',
      host: 'github.example.com',
      owner: 'secure-owner',
      name: 'secure-repo',
      branch: 'main',
      token: 'repo-github-token'
    });
    const repo = repos[0];

    svc.getTokenFromConfigFile = vi.fn(() => 'global-token');
    svc.getTokenFromCommand = vi.fn(() => 'cli-token');
    svc.getTokenFromGitCredential = vi.fn(() => 'git-token');

    expect(svc.getGitHubToken({
      id: repo.id,
      provider: repo.provider,
      host: repo.host,
      owner: repo.owner,
      name: repo.name,
      branch: repo.branch
    })).toBe('repo-github-token');
    expect(svc.getTokenFromConfigFile).not.toHaveBeenCalled();
  });

  it('updateRepoAuth can set and clear a GitLab repo token', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const repos = svc.addRepo({
      provider: 'gitlab',
      host: 'gitlab.example.com',
      projectPath: 'team/subgroup/skills-repo',
      branch: 'main'
    });
    const repo = repos[0];

    let updated = svc.updateRepoAuth('', '', '', 'gitlab-secret-token', false, repo.id);
    expect(updated[0].token).toBe('gitlab-secret-token');

    updated = svc.updateRepoAuth('', '', '', '', true, repo.id);
    expect(updated[0].token).toBeUndefined();
  });
});

describe('SkillService.getInstalledSkills', () => {
  it('returns an array (empty when install dir has no skill files)', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skills = svc.getInstalledSkills();
    expect(Array.isArray(skills)).toBe(true);
  });

  it('listSkills includes skills installed only in the native platform directory', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('codex');
    const nativeSkillDir = path.join(svc.installDir, 'native-only');
    fs.mkdirSync(nativeSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(nativeSkillDir, 'SKILL.md'),
      '---\nname: Native Only\ndescription: From native dir\n---\nUse native skill',
      'utf-8'
    );

    const skills = await svc.listSkills(true);
    const nativeSkill = skills.find(skill => skill.directory === 'native-only');

    expect(nativeSkill).toEqual(expect.objectContaining({
      directory: 'native-only',
      installed: true,
      source: 'native-installed'
    }));
  });

  it('marks Codex .system skills as protected system-installed entries', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('codex');
    const systemSkillDir = path.join(svc.installDir, '.system', 'skill-installer');
    fs.mkdirSync(systemSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(systemSkillDir, 'SKILL.md'),
      '---\nname: skill-installer\ndescription: System skill\n---\nBody',
      'utf-8'
    );

    const skills = await svc.listSkills(true);
    const systemSkill = skills.find(skill => skill.directory === '.system/skill-installer');

    expect(systemSkill).toEqual(expect.objectContaining({
      directory: '.system/skill-installer',
      installed: true,
      source: 'system-installed',
      protected: true,
      isLocal: false
    }));
  });
});

describe('SkillService.getSkillDetail', () => {
  it('returns absolute paths for installed skills', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.installDir, 'detail-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Detail Skill\ndescription: Has path\n---\nBody',
      'utf-8'
    );

    const detail = await svc.getSkillDetail('detail-skill');

    expect(detail).toEqual(expect.objectContaining({
      directory: 'detail-skill',
      installed: true,
      path: skillDir,
      installPath: skillDir,
      fullPath: path.join(skillDir, 'SKILL.md')
    }));
  });

  it('returns absolute paths for local repository skills', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const repoRoot = path.join(testDir, 'repo');
    const skillDir = path.join(repoRoot, 'skills', 'repo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Repo Skill\ndescription: From repo\n---\nBody',
      'utf-8'
    );

    const detail = await svc.getSkillDetail('repo-skill', {
      provider: 'local',
      localPath: repoRoot,
      directory: 'skills'
    }, 'skills/repo-skill');

    expect(detail).toEqual(expect.objectContaining({
      directory: 'repo-skill',
      installed: false,
      path: skillDir,
      fullPath: path.join(skillDir, 'SKILL.md')
    }));
  });
});

describe('SkillService file operations', () => {
  it('createCustomSkill writes SKILL.md with frontmatter into storage dir', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');

    const result = svc.createCustomSkill({
      name: 'My Skill',
      directory: 'my-skill',
      description: 'Helpful',
      content: 'Use it wisely'
    });

    const skillPath = path.join(svc.storageDir, 'my-skill', 'SKILL.md');
    expect(result.success).toBe(true);
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.readFileSync(skillPath, 'utf-8')).toContain('name: "My Skill"');
    expect(fs.readFileSync(skillPath, 'utf-8')).toContain('Use it wisely');
  });

  it('createSkillWithFiles requires SKILL.md', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');

    expect(() => svc.createSkillWithFiles({
      directory: 'bundle',
      files: [{ path: 'notes.txt', content: 'missing skill file' }]
    })).toThrow(/SKILL\.md/);
  });

  it('createSkillWithFiles writes text and base64 files', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');

    const result = svc.createSkillWithFiles({
      directory: 'bundle',
      files: [
        { path: 'SKILL.md', content: '# Title' },
        { path: 'assets/icon.bin', content: Buffer.from('png').toString('base64'), isBase64: true }
      ]
    });

    expect(result.fileCount).toBe(2);
    expect(fs.readFileSync(path.join(svc.storageDir, 'bundle', 'SKILL.md'), 'utf-8')).toBe('# Title');
    expect(fs.readFileSync(path.join(svc.storageDir, 'bundle', 'assets', 'icon.bin')).toString()).toBe('png');
  });

  it('createSkillWithFiles rejects unsafe file paths', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');

    expect(() => svc.createSkillWithFiles({
      directory: 'bundle',
      files: [
        { path: 'SKILL.md', content: '# Title' },
        { path: '../outside.txt', content: 'escape' }
      ]
    })).toThrow(/Invalid skill file path/);

    expect(fs.existsSync(path.join(svc.storageDir, 'outside.txt'))).toBe(false);
  });

  it('getSkillFileContent returns text files as utf-8', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.installDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'README.md'), '# Readme', 'utf-8');

    const result = svc.getSkillFileContent('my-skill', 'README.md');

    expect(result.isBase64).toBe(false);
    expect(result.content).toBe('# Readme');
  });

  it('getSkillFileContent returns binary files as base64', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.installDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'logo.bin'), Buffer.from('bin-data'));

    const result = svc.getSkillFileContent('my-skill', 'logo.bin');

    expect(result.isBase64).toBe(true);
    expect(Buffer.from(result.content, 'base64').toString()).toBe('bin-data');
  });

  it('rejects path traversal in skill file operations', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.installDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'README.md'), '# Readme', 'utf-8');

    expect(() => svc.getSkillFileContent('my-skill', '../secret.txt')).toThrow(/Invalid skill file path/);
    expect(() => svc.addSkillFiles('my-skill', [{ path: '../secret.txt', content: 'x' }])).toThrow(/Invalid skill file path/);
    expect(() => svc.deleteSkillFile('my-skill', '../secret.txt')).toThrow(/Invalid skill file path/);
    expect(() => svc.updateSkillFile('my-skill', '../secret.txt', 'x')).toThrow(/Invalid skill file path/);
  });

  it('addSkillFiles writes nested files into installed skill', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.installDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });

    const result = svc.addSkillFiles('my-skill', [
      { path: 'docs/guide.md', content: '# Guide' }
    ]);

    expect(result.added).toEqual(['docs/guide.md']);
    expect(fs.readFileSync(path.join(skillDir, 'docs', 'guide.md'), 'utf-8')).toBe('# Guide');
  });

  it('deleteSkillFile refuses to remove SKILL.md', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.installDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill', 'utf-8');

    expect(() => svc.deleteSkillFile('my-skill', 'SKILL.md')).toThrow(/不能删除 SKILL\.md/);
  });

  it('updateSkillFile overwrites file content', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.installDir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'README.md'), '# Old', 'utf-8');

    const result = svc.updateSkillFile('my-skill', 'README.md', '# New');

    expect(result.updated).toBe('README.md');
    expect(fs.readFileSync(path.join(skillDir, 'README.md'), 'utf-8')).toBe('# New');
  });

  it('installLocalSkill copies hosted skill into install dir', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const localSkillDir = path.join(svc.storageDir, 'local-skill');
    fs.mkdirSync(localSkillDir, { recursive: true });
    fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), '# Local', 'utf-8');

    const result = svc.installLocalSkill('local-skill');

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(svc.installDir, 'local-skill', 'SKILL.md'))).toBe(true);
  });

  it('uninstallSkill rejects unsafe target directories without deleting outside files', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const outsideDir = path.join(testDir, 'victim');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'SKILL.md'), '# Victim', 'utf-8');

    expect(() => svc.uninstallSkill('../victim')).toThrow(/Invalid skill directory/);
    expect(fs.existsSync(path.join(outsideDir, 'SKILL.md'))).toBe(true);
  });

  it('refuses to uninstall or modify Codex system skills', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('codex');
    const systemSkillDir = path.join(svc.installDir, '.system', 'skill-installer');
    fs.mkdirSync(systemSkillDir, { recursive: true });
    fs.writeFileSync(path.join(systemSkillDir, 'SKILL.md'), '# System', 'utf-8');
    fs.writeFileSync(path.join(systemSkillDir, 'README.md'), '# Readme', 'utf-8');

    expect(() => svc.uninstallSkill('.system/skill-installer')).toThrow(/系统技能/);
    expect(() => svc.addSkillFiles('.system/skill-installer', [{ path: 'notes.md', content: 'x' }])).toThrow(/系统技能/);
    expect(() => svc.deleteSkillFile('.system/skill-installer', 'README.md')).toThrow(/系统技能/);
    expect(() => svc.updateSkillFile('.system/skill-installer', 'README.md', 'x')).toThrow(/系统技能/);
    expect(fs.existsSync(path.join(systemSkillDir, 'SKILL.md'))).toBe(true);
  });

  it('uninstallSkill returns not installed when target is absent', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');

    expect(svc.uninstallSkill('missing-skill')).toEqual({
      success: true,
      message: 'Not installed'
    });
  });
});

describe('SkillService local repository path safety', () => {
  it('scans only the configured skills directory in mixed plugin/skill repositories', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const repoRoot = path.join(testDir, 'mixed-skill-plugin-repo');

    fs.mkdirSync(path.join(repoRoot, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'plugins', 'skill-bundle', 'skills', 'nested-demo'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'skills', 'plain-skill'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'template'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'mixed-market',
        plugins: [{ name: 'skill-bundle', source: './plugins/skill-bundle' }]
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(repoRoot, 'plugins', 'skill-bundle', 'skills', 'nested-demo', 'SKILL.md'),
      '---\nname: Nested Demo\ndescription: Plugin-contained skill\n---\nBody',
      'utf8'
    );
    fs.writeFileSync(
      path.join(repoRoot, 'skills', 'plain-skill', 'SKILL.md'),
      '---\nname: Plain Skill\ndescription: Plain repository skill\n---\nBody',
      'utf8'
    );
    fs.writeFileSync(
      path.join(repoRoot, 'template', 'SKILL.md'),
      '---\nname: Template Skill\ndescription: Template\n---\nBody',
      'utf8'
    );

    const skills = await svc.fetchLocalRepoSkills({
      provider: 'local',
      localPath: repoRoot,
      directory: 'skills',
      branch: 'main',
      id: 'local:mixed::skills'
    });

    expect(skills).toEqual([
      expect.objectContaining({
        name: 'Plain Skill',
        directory: 'plain-skill',
        fullDirectory: 'skills/plain-skill',
        repoDirectory: 'skills'
      })
    ]);
  });

  it('rejects unsafe local repo scan directories', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const repoRoot = path.join(testDir, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    await expect(svc.fetchLocalRepoSkills({
      provider: 'local',
      localPath: repoRoot,
      directory: '../outside'
    })).rejects.toThrow(/Invalid skill repository directory/);
  });

  it('rejects unsafe local repo skill file paths', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const repoRoot = path.join(testDir, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    await expect(svc.fetchSkillFileContent({
      provider: 'local',
      localPath: repoRoot
    }, {
      path: '../secret/SKILL.md'
    })).rejects.toThrow(/Invalid skill repository file path/);
  });
});
