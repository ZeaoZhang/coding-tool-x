// globals: true in vitest.config.js

const os = require('os');
const fs = require('fs');
const path = require('path');

let testDir;
let ompRuntimeDir;

function stubPaths() {
  const p = require.resolve('../../../src/config/paths');
  require.cache[p] = {
    id: p,
    filename: p,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        claude: {
          dir: path.join(testDir, 'native-claude'),
          settings: path.join(testDir, 'native-claude', 'settings.json'),
          skills: path.join(testDir, 'claude-skills'),
          plugins: path.join(testDir, 'native-claude', 'plugins')
        },
        codex:     { dir: path.join(testDir, 'native-codex'),    skills: path.join(testDir, 'codex-skills') },
        gemini:    { dir: path.join(testDir, 'native-gemini'),   skills: path.join(testDir, 'gemini-skills') },
        opencode:  { dir: path.join(testDir, 'native-opencode'), config: path.join(testDir, 'opencode-config'), skills: path.join(testDir, 'opencode-skills') },
        omp: { dir: path.join(testDir, 'native-omp'), skills: path.join(testDir, 'native-omp', 'skills') }
      },
      HOME_DIR: testDir,
      PATHS: {
        base:   testDir,
        config: path.join(testDir, 'config'),
        effectiveControlManifest: path.join(testDir, 'config', 'effective-control.json'),
        skillArtifacts: path.join(testDir, 'artifacts'),
        skillRefreshTasks: path.join(testDir, 'runtime', 'skill-refresh-tasks.json'),
        localSkills: {
          claude:   path.join(testDir, 'local', 'claude'),
          codex:    path.join(testDir, 'local', 'codex'),
          gemini:   path.join(testDir, 'local', 'gemini'),
          opencode: path.join(testDir, 'local', 'opencode'),
          omp:      path.join(testDir, 'local', 'omp')
        },
        skillRepos: {
          claude:   path.join(testDir, 'repos', 'claude.json'),
          codex:    path.join(testDir, 'repos', 'codex.json'),
          gemini:   path.join(testDir, 'repos', 'gemini.json'),
          opencode: path.join(testDir, 'repos', 'opencode.json'),
          omp:      path.join(testDir, 'repos', 'omp.json')
        },
        skillCaches: {
          claude:   path.join(testDir, 'cache', 'claude.json'),
          codex:    path.join(testDir, 'cache', 'codex.json'),
          gemini:   path.join(testDir, 'cache', 'gemini.json'),
          opencode: path.join(testDir, 'cache', 'opencode.json'),
          omp:      path.join(testDir, 'cache', 'omp.json')
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
          description: descriptionMatch ? descriptionMatch[1].replace(/^["']|["']$/g, '') : null,
          body: c,
          format: options.platform === 'codex' ? 'codex' : 'claude'
        };
      }),
      convertSkillToCodex: vi.fn(content => ({ content, warnings: [] }))
    }
  };
}

function stubOmpConfig() {
  ompRuntimeDir = path.join(testDir, 'runtime-omp');
  const modulePath = require.resolve('../../../src/server/services/omp-config');
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: {
      getOmpCommand: vi.fn(() => 'missing-omp-test-command'),
      getOmpPaths: vi.fn(() => ({
        agentDir: ompRuntimeDir,
        settings: path.join(ompRuntimeDir, 'config.yml'),
        settingsJsonLegacy: path.join(ompRuntimeDir, 'settings.json'),
        skills: path.join(ompRuntimeDir, 'skills')
      })),
      readOmpSettings: vi.fn(() => ({ skills: { enabled: true } }))
    }
  };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-svc-'));
  stubPaths();
  stubFormatConverter();
  stubOmpConfig();
  delete require.cache[require.resolve('../../../src/server/services/omp-skill-discovery')];
  delete require.cache[require.resolve('../../../src/server/services/skill-projection-service')];
  delete require.cache[require.resolve('../../../src/server/services/skill-service')];
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete require.cache[require.resolve('../../../src/server/services/skill-service')];
  delete require.cache[require.resolve('../../../src/config/paths')];
  delete require.cache[require.resolve('../../../src/server/services/omp-config')];
  delete require.cache[require.resolve('../../../src/server/services/omp-skill-discovery')];
  delete require.cache[require.resolve('../../../src/server/services/skill-projection-service')];
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
    expect(DEFAULT_REPOS_BY_PLATFORM).toHaveProperty('omp');
  });

  it('each platform entry is an array', () => {
    const { DEFAULT_REPOS_BY_PLATFORM } = require('../../../src/server/services/skill-service');
    for (const platform of ['claude', 'codex', 'gemini', 'opencode', 'omp']) {
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

  it('uses the configured Claude native skills directory', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    expect(svc.installDir).toBe(path.join(testDir, 'claude-skills'));
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

  it('sets platform to omp when passed omp', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    expect(svc.platform).toBe('omp');
    expect(svc.installDir).toBe(path.join(ompRuntimeDir, 'skills'));
    expect(svc.installDir).not.toBe(path.join(testDir, 'native-omp', 'skills'));
  });

  it('sets platform to opencode when passed opencode', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('opencode');
    expect(svc.platform).toBe('opencode');
  });

  it('rejects an invalid platform string instead of falling back to Claude', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    expect(() => new SkillService('invalid-platform')).toThrow(/Invalid platform/);
  });

  it('falls back to claude for empty string platform', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('');
    expect(svc.platform).toBe('claude');
  });

  it('maps the deprecated pi platform to omp', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    expect(new SkillService(' PI ').platform).toBe('omp');
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

  it('marks removed repo artifacts orphaned without deleting their content', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const [repo] = svc.addRepo({
      owner: 'orphan-owner',
      name: 'orphan-repo',
      branch: 'main',
      directory: '',
      enabled: true
    });
    const sourceKey = `repo:${repo.id}:skill`;
    const artifact = svc.artifactStore.publishSkill({
      platform: 'claude',
      sourceKey,
      format: 'claude-skill-v1',
      files: [{ relativePath: 'SKILL.md', content: '# Orphan' }],
      metadata: { repoId: repo.id, name: 'orphan', directory: 'orphan' }
    });
    const target = path.join(svc.installDir, 'orphan');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), '# Orphan');
    const controlKey = `skill:claude:user:user:${sourceKey}`;
    svc.controlService.registerSkill({
      kind: 'skill',
      controlKey,
      platform: 'claude',
      scope: 'user',
      sourceKey,
      targetDirectory: 'orphan',
      artifact: { ...artifact, state: 'ready' },
      enabled: true,
      trust: 'approved',
      projection: { mode: 'native-copy', state: 'enabled', sourceKey },
      managed: true
    });

    svc.removeRepo('orphan-owner', 'orphan-repo', '', repo.id);

    expect(svc.artifactStore.get({
      platform: 'claude',
      sourceKey,
      format: 'claude-skill-v1'
    })).toEqual(expect.objectContaining({ state: 'orphaned', contentHash: expect.any(String) }));
    expect(fs.existsSync(target)).toBe(false);
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
  it('rejects GitLab repositories without a valid project path', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');

    expect(() => svc.normalizeRepoConfig({
      provider: 'gitlab',
      host: 'gitlab.example.com',
      projectPath: ''
    })).toThrow(/GitLab project path/i);
    expect(() => svc.normalizeRepoConfig({
      provider: 'gitlab',
      host: 'gitlab.example.com',
      projectPath: '../private'
    })).toThrow(/GitLab project path/i);
  });
});

describe('SkillService.getInstalledSkills', () => {
  it('OMP discovery deduplicates different names that resolve to the same SKILL.md realpath', () => {
    const { deduplicateDiscoveredSkills } = require('../../../src/server/services/omp-skill-discovery');
    const skills = deduplicateDiscoveredSkills([
      {
        name: 'primary-name',
        realPath: '/same/SKILL.md',
        sourceProvider: 'native',
        sourceScope: 'user',
        sourcePath: '/native/SKILL.md',
        shadowedSources: []
      },
      {
        name: 'alias-name',
        realPath: '/same/SKILL.md',
        sourceProvider: 'custom',
        sourceScope: 'user',
        sourcePath: '/custom/SKILL.md',
        shadowedSources: []
      }
    ]);

    expect(skills).toEqual([
      expect.objectContaining({
        name: 'primary-name',
        shadowedSources: [
          expect.objectContaining({
            sourceProvider: 'custom',
            sourcePath: '/custom/SKILL.md'
          })
        ]
      })
    ]);
  });

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

  it('OMP discovers one-level native skills, requires description, and ignores nested skills', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    const skillsRoot = path.join(ompRuntimeDir, 'skills');
    fs.mkdirSync(path.join(skillsRoot, 'valid'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, 'valid', 'SKILL.md'),
      '---\nname: valid\ndescription: Native skill\n---\nBody'
    );
    fs.mkdirSync(path.join(skillsRoot, 'missing-description'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, 'missing-description', 'SKILL.md'),
      '---\nname: missing-description\n---\nBody'
    );
    fs.mkdirSync(path.join(skillsRoot, 'group', 'nested'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, 'group', 'nested', 'SKILL.md'),
      '---\nname: nested\ndescription: Nested skill\n---\nBody'
    );

    const skills = await svc.listSkills(true);

    expect(skills.map(skill => skill.name)).toEqual(['valid']);
    expect(skills[0]).toEqual(expect.objectContaining({
      sourceProvider: 'native',
      sourceScope: 'user',
      sourcePath: path.join(skillsRoot, 'valid', 'SKILL.md'),
      installed: true,
      readonly: false,
      shadowedSources: []
    }));
  });

  it('OMP retains same-name Skills from distinct providers for projection conflict handling', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    const nativeRoot = path.join(ompRuntimeDir, 'skills', 'shared');
    const claudeRoot = path.join(testDir, 'claude-skills', 'shared');
    fs.mkdirSync(nativeRoot, { recursive: true });
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(nativeRoot, 'SKILL.md'),
      '---\nname: shared\ndescription: Native skill\n---\nBody'
    );
    fs.writeFileSync(
      path.join(claudeRoot, 'SKILL.md'),
      '---\nname: shared\n---\nExternal body'
    );

    const skills = await svc.listSkills(true);

    expect(skills.filter(skill => skill.name.toLowerCase() === 'shared')).toHaveLength(2);
    expect(skills.map(skill => skill.sourceProvider)).toEqual(expect.arrayContaining(['native', 'claude']));
  });

  it('OMP resolves its native path again for every scan instead of retaining a profile path', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    const nextRuntimeDir = path.join(testDir, 'runtime-omp-next-profile');
    const nextSkillDir = path.join(nextRuntimeDir, 'skills', 'dynamic');
    fs.mkdirSync(nextSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(nextSkillDir, 'SKILL.md'),
      '---\nname: dynamic\ndescription: Dynamic profile skill\n---\nBody'
    );

    ompRuntimeDir = nextRuntimeDir;
    const skills = await svc.listSkills(true);

    expect(svc.installDir).toBe(path.join(nextRuntimeDir, 'skills'));
    expect(skills).toContainEqual(expect.objectContaining({
      name: 'dynamic',
      sourcePath: path.join(nextSkillDir, 'SKILL.md')
    }));
  });

  it('OMP provider settings affect discovery while cached artifacts remain local', async () => {
    const ompConfig = require('../../../src/server/services/omp-config');
    const claudeRoot = path.join(testDir, 'claude-skills');
    for (const name of ['included', 'ignored', 'not-included']) {
      const skillDir = path.join(claudeRoot, name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---\nname: ${name}\n---\nBody`
      );
    }
    ompConfig.readOmpSettings.mockReturnValue({
      skills: {
        enabled: true,
        enableClaudeUser: true,
        includeSkills: ['included', 'ignored'],
        ignoredSkills: ['ignored']
      }
    });

    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    expect((await svc.listSkills(true)).map(skill => skill.name)).toEqual(['included']);

    ompConfig.readOmpSettings.mockReturnValue({
      skills: { enabled: true, enableClaudeUser: false }
    });
    expect((await svc.listSkills(true)).map(skill => skill.name)).toEqual(['included']);
  });

  it('OMP external provider skills are installed and readonly without description', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    const claudeSkill = path.join(testDir, 'claude-skills', 'external');
    fs.mkdirSync(claudeSkill, { recursive: true });
    fs.writeFileSync(path.join(claudeSkill, 'SKILL.md'), '---\nname: external\n---\nBody');

    const skills = await svc.listSkills(true);

    expect(skills).toContainEqual(expect.objectContaining({
      name: 'external',
      sourceProvider: 'claude',
      installed: true,
      readonly: true
    }));
  });

  it('OMP discovers skills bundled by installed Claude plugins', async () => {
    const pluginRoot = path.join(testDir, 'claude-plugin-cache', 'demo-plugin');
    const skillRoot = path.join(pluginRoot, 'skills', 'plugin-skill');
    const installedFile = path.join(testDir, 'native-claude', 'plugins', 'installed_plugins.json');
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.mkdirSync(path.dirname(installedFile), { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, 'SKILL.md'),
      '---\nname: plugin-skill\n---\nPlugin skill without a description',
      'utf8'
    );
    fs.writeFileSync(installedFile, JSON.stringify({
      plugins: {
        'demo-plugin@community': [{
          installPath: pluginRoot,
          scope: 'user'
        }]
      }
    }), 'utf8');

    const { SkillService } = require('../../../src/server/services/skill-service');
    const skills = await new SkillService('omp').listSkills(true);

    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'plugin-skill',
        sourceProvider: 'claude-plugins',
        sourceScope: 'user',
        installed: true,
        readonly: true
      })
    ]));
  });

  it('OMP global discovery excludes project-scoped provider skills until cwd is supplied', async () => {
    const pluginRoot = path.join(testDir, 'claude-plugin-cache', 'project-plugin');
    const skillRoot = path.join(pluginRoot, 'skills', 'project-provider-skill');
    const installedFile = path.join(testDir, 'native-claude', 'plugins', 'installed_plugins.json');
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.mkdirSync(path.dirname(installedFile), { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, 'SKILL.md'),
      '---\nname: project-provider-skill\n---\nProject plugin skill',
      'utf8'
    );
    fs.writeFileSync(installedFile, JSON.stringify({
      plugins: {
        'project-plugin@community': [{
          installPath: pluginRoot,
          scope: 'project'
        }]
      }
    }), 'utf8');

    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');

    expect((await svc.listSkills(true)).map(skill => skill.name))
      .not.toContain('project-provider-skill');
    expect((await svc.listSkills(true, { cwd: testDir })).map(skill => skill.name))
      .toContain('project-provider-skill');
  });

  it('OMP includes one-level project-native skills only when cwd is supplied', async () => {
    const projectSkill = path.join(testDir, '.omp', 'skills', 'project-native');
    fs.mkdirSync(projectSkill, { recursive: true });
    fs.writeFileSync(
      path.join(projectSkill, 'SKILL.md'),
      '---\nname: project-native\ndescription: Project native skill\n---\nBody',
      'utf8'
    );

    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');

    expect((await svc.listSkills(true)).map(skill => skill.name)).not.toContain('project-native');
    expect(await svc.listSkills(true, { cwd: testDir })).toContainEqual(expect.objectContaining({
      name: 'project-native',
      sourceProvider: 'native',
      sourceScope: 'project',
      readonly: false
    }));
  });

  it('rejects project Skill roots that are symlinks', async () => {
    const outsideRoot = path.join(testDir, 'outside-omp-skills');
    const projectRoot = path.join(testDir, 'omp-project');
    const projectSkillsRoot = path.join(projectRoot, '.omp', 'skills');
    fs.mkdirSync(path.join(outsideRoot, 'escaped'), { recursive: true });
    fs.mkdirSync(path.dirname(projectSkillsRoot), { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(outsideRoot, 'escaped', 'SKILL.md'), '---\nname: escaped\ndescription: outside\n---\nBody');
    fs.symlinkSync(outsideRoot, projectSkillsRoot, 'dir');

    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');

    await expect(svc.scanSkills({
      scope: 'project',
      cwd: projectRoot
    })).rejects.toThrow(/symlink/i);
  });

  it('OMP classifies a custom directory equal to cwd as project scope', async () => {
    const projectRoot = path.join(testDir, 'omp-custom-project');
    const skillRoot = path.join(projectRoot, 'child');
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: custom-child\ndescription: custom\n---\nBody');
    const ompConfig = require('../../../src/server/services/omp-config');
    ompConfig.readOmpSettings.mockReturnValue({
      skills: {
        enabled: true,
        customDirectories: ['.']
      }
    });

    const { SkillService } = require('../../../src/server/services/skill-service');
    const result = await new SkillService('omp').scanSkills({
      scope: 'project',
      cwd: projectRoot
    });

    expect(result.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'custom-child', sourceScope: 'project' })
    ]));
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
      path: expect.stringContaining(path.join('artifacts', 'claude')),
      installPath: expect.stringContaining(path.join('artifacts', 'claude')),
      fullPath: expect.stringContaining(path.join('artifacts', 'claude'))
    }));
  });

  it('returns absolute paths for published local artifacts without remote fetch', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const artifact = svc.artifactStore.publishSkill({
      platform: 'claude',
      sourceKey: 'repo:local-repo:skills/repo-skill',
      format: 'claude-skill-v1',
      files: [{
        relativePath: 'SKILL.md',
        content: '---\nname: Repo Skill\ndescription: From repo\n---\nBody'
      }],
      metadata: {
        name: 'Repo Skill',
        directory: 'repo-skill',
        fullDirectory: 'skills/repo-skill',
        sourceProvider: 'remote',
        sourceScope: 'user',
        repoId: 'local-repo'
      }
    });

    const detail = await svc.getSkillDetail('repo-skill', null, 'skills/repo-skill');

    expect(detail).toEqual(expect.objectContaining({
      directory: 'repo-skill',
      installed: false,
      cached: true,
      path: artifact.root,
      fullPath: path.join(artifact.root, 'SKILL.md')
    }));
  });

  it('reads omp skills discovered from non-native providers (agents global) via cache', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    const skillDir = path.join(testDir, 'agents-global', 'agent-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Agent Skill\ndescription: From agents\n---\nAgent body',
      'utf-8'
    );

    // 与 discoverOmpSkills 产出的 agents provider 条目一致（不在 native 安装目录）
    svc.skillsCache = [{
      name: 'agent-skill',
      description: 'From agents',
      directory: 'agent-skill',
      installed: true,
      isLocal: false,
      source: 'provider-installed',
      sourceProvider: 'agents',
      sourceScope: 'user',
      sourcePath: path.join(skillDir, 'SKILL.md'),
      realPath: path.join(skillDir, 'SKILL.md'),
      readonly: true,
      shadowedSources: [],
      protected: false,
      readmeUrl: null,
      repoOwner: null,
      repoName: null,
      repoBranch: null,
      license: null
    }];

    const detail = await svc.getSkillDetail('agent-skill', null, '');

    expect(detail).toEqual(expect.objectContaining({
      directory: 'agent-skill',
      installed: true,
      readonly: true,
      sourceProvider: 'agents',
      sourceScope: 'user',
      content: 'Agent body',
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

  it('no longer exposes install or uninstall lifecycle methods', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');

    expect(svc.installSkill).toBeUndefined();
    expect(svc.installLocalSkill).toBeUndefined();
    expect(svc.uninstallSkill).toBeUndefined();
  });

  it('refuses to modify Codex system skills', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('codex');
    const systemSkillDir = path.join(svc.installDir, '.system', 'skill-installer');
    fs.mkdirSync(systemSkillDir, { recursive: true });
    fs.writeFileSync(path.join(systemSkillDir, 'SKILL.md'), '# System', 'utf-8');
    fs.writeFileSync(path.join(systemSkillDir, 'README.md'), '# Readme', 'utf-8');

    expect(() => svc.addSkillFiles('.system/skill-installer', [{ path: 'notes.md', content: 'x' }])).toThrow(/系统技能/);
    expect(() => svc.deleteSkillFile('.system/skill-installer', 'README.md')).toThrow(/系统技能/);
    expect(() => svc.updateSkillFile('.system/skill-installer', 'README.md', 'x')).toThrow(/系统技能/);
    expect(fs.existsSync(path.join(systemSkillDir, 'SKILL.md'))).toBe(true);
  });
});

describe('SkillService cache scheduling', () => {
  it('scanSkills ignores stale prepared state and never loads remote repositories', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    svc.skillsCache = [{
      name: 'prepared',
      description: 'cached',
      directory: 'prepared',
      installed: true,
      sourceProvider: 'remote'
    }];
    svc.cacheTime = Date.now();
    const fetchRepos = vi.spyOn(svc, 'fetchRepoSkills');

    const result = await svc.scanSkills({ scope: 'user' });

    expect(result.skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'prepared' })
    ]));
    expect(fetchRepos).not.toHaveBeenCalled();
  });
});

describe('OMP discovery cache', () => {
  it('reuses settings and plugin path CLI results for the same scope and cwd', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const { discoverOmpSkills } = require('../../../src/server/services/omp-skill-discovery');
    const svc = new SkillService('omp');
    const ompConfig = require('../../../src/server/services/omp-config');
    const cwd = path.join(testDir, 'project');
    fs.mkdirSync(cwd, { recursive: true });

    discoverOmpSkills(svc, { cwd, scope: 'user' });
    discoverOmpSkills(svc, { cwd, scope: 'user' });
    discoverOmpSkills(svc, { cwd, scope: 'project' });

    expect(ompConfig.getOmpCommand).toHaveBeenCalledTimes(4);
  });

  it('scanSkills does not refresh remote OMP repositories', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    const fetchRepos = vi.spyOn(svc, 'fetchRepoSkills');
    const cwd = path.join(testDir, 'omp-project');
    fs.mkdirSync(cwd, { recursive: true });

    await Promise.all(Array.from({ length: 20 }, () => svc.scanSkills({
      scope: 'project',
      cwd
    })));

    expect(fetchRepos).not.toHaveBeenCalled();
  });
});

describe('SkillService credential cache', () => {
  it('shares host token resolution across service instances', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const credentialCache = require('../../../src/server/services/remote-credential-cache');
    const previousToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      credentialCache.clear();
      const first = new SkillService('claude');
      const second = new SkillService('omp');
      first.getTokenFromCommand = vi.fn(() => 'shared-token');
      second.getTokenFromCommand = vi.fn(() => 'unexpected-second-token');
      first.getTokenFromGitCredential = vi.fn(() => null);
      second.getTokenFromGitCredential = vi.fn(() => null);

      expect(first.getGitHubToken('https://github.example')).toBe('shared-token');
      expect(second.getGitHubToken('https://github.example')).toBe('shared-token');
      expect(first.getTokenFromCommand).toHaveBeenCalledTimes(1);
      expect(second.getTokenFromCommand).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousToken;
      credentialCache.clear();
    }
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

  it('rejects local repository roots that are symlinks', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const realRoot = path.join(testDir, 'real-repo');
    const linkedRoot = path.join(testDir, 'linked-repo');
    fs.mkdirSync(realRoot, { recursive: true });
    fs.symlinkSync(realRoot, linkedRoot, 'dir');

    await expect(svc.fetchLocalRepoSkills({
      provider: 'local',
      localPath: linkedRoot
    })).rejects.toThrow(/symlink/i);
  });

  it('rejects symlinked local repository subdirectories', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const repoRoot = path.join(testDir, 'repo-with-link');
    const outsideRoot = path.join(testDir, 'outside-repo');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.symlinkSync(outsideRoot, path.join(repoRoot, 'skills-link'), 'dir');

    await expect(svc.fetchLocalRepoSkills({
      provider: 'local',
      localPath: repoRoot,
      directory: 'skills-link'
    })).rejects.toThrow(/symlink/i);
  });
});

describe('SkillService project scope', () => {
  it('scans a Skill in the project canonical directory', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('codex');
    const projectRoot = path.join(testDir, 'project-scope');
    const projectSkillDir = path.join(projectRoot, '.agents', 'skills', 'repo-skill');
    fs.mkdirSync(projectSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectSkillDir, 'SKILL.md'),
      '---\nname: Repo Skill\ndescription: Project skill\n---\nBody',
      'utf8'
    );

    const result = await svc.scanSkills({ scope: 'project', cwd: projectRoot });
    const skills = result.skills;

    expect(fs.existsSync(path.join(projectSkillDir, 'SKILL.md'))).toBe(true);
    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        directory: 'repo-skill',
        sourceScope: 'project',
        enabled: true,
        managed: true
      })
    ]));
  });

  it('keeps user and project prepared caches separate', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const projectRoot = path.join(testDir, 'cache-project');
    fs.mkdirSync(projectRoot, { recursive: true });

    await svc.listSkills(false, { scope: 'user' });
    await svc.listSkills(false, { scope: 'project', cwd: projectRoot });

    expect([...svc._preparedSkillsCache.keys()]).toEqual(expect.arrayContaining([
      'user:',
      `project:${fs.realpathSync(projectRoot)}`
    ]));
  });
});

describe('SkillService scan-only control surface', () => {
  it('scanSkills never performs a network refresh', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    svc.refreshRemoteSkills = vi.fn(() => {
      throw new Error('network called');
    });

    const result = await svc.scanSkills({ scope: 'user' });

    expect(svc.refreshRemoteSkills).not.toHaveBeenCalled();
    expect(result.refresh.state).toMatch(/never_fetched|idle/);
  });

  it('reports the latest terminal refresh task in scan snapshots', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const { PATHS } = require('../../../src/config/paths');
    const svc = new SkillService('claude');
    fs.mkdirSync(path.dirname(PATHS.skillRefreshTasks), { recursive: true });
    fs.writeFileSync(PATHS.skillRefreshTasks, JSON.stringify({
      version: 1,
      tasks: [{
        id: 'failed-refresh',
        platform: 'claude',
        scope: 'user',
        status: 'failed',
        createdAt: Date.now() - 10,
        finishedAt: Date.now(),
        error: 'remote token=secret-value'
      }]
    }));

    const result = await svc.scanSkills({ scope: 'user' });

    expect(result.refresh).toEqual(expect.objectContaining({
      state: 'failed',
      taskId: 'failed-refresh',
      error: 'remote token=[REDACTED]'
    }));
  });

  it('project and user scans use independent canonical cache keys', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const projectRoot = path.join(testDir, 'scan-project');
    fs.mkdirSync(projectRoot, { recursive: true });

    await svc.scanSkills({ scope: 'user' });
    await svc.scanSkills({ scope: 'project', cwd: projectRoot });

    expect([...svc._preparedSkillsCache.keys()]).toEqual(expect.arrayContaining([
      'user:',
      `project:${fs.realpathSync(projectRoot)}`
    ]));
  });

  it('keeps missing control entries visible with a missing artifact state', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const control = svc.controlService.registerSkill({
      kind: 'skill',
      platform: 'claude',
      scope: 'user',
      projectPath: null,
      sourceKey: 'repo:missing:skills/ghost',
      source: { kind: 'remote', repoId: 'repo:missing', fullDirectory: 'skills/ghost', revision: 'commit-a' },
      artifact: { root: path.join(testDir, 'does-not-exist'), state: 'metadata_only' },
      targetDirectory: 'ghost',
      cached: false,
      enabled: false,
      trust: 'needs_review',
      projection: { mode: 'native-copy', state: 'disabled' },
      managed: true
    });

    const result = await svc.scanSkills({ scope: 'user' });
    const missing = result.skills.find(skill => skill.controlKey === control.controlKey);

    expect(missing).toEqual(expect.objectContaining({
      artifactState: 'missing',
      cached: false,
      enabled: false,
      trust: 'needs_review',
      managed: true
    }));
  });

  it('updates the managed artifact when local Skill content changes', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.storageDir, 'mutable');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: mutable\n---\nfirst');

    const first = await svc.scanSkills({ scope: 'user' });
    const initial = first.skills.find(skill => skill.directory === 'mutable');
    const initialHash = initial.artifact.contentHash;
    svc.controlService.setSkillTrust({ controlKey: initial.controlKey, scope: 'user', trust: 'approved' });
    svc.controlService.setSkillEnabled({ controlKey: initial.controlKey, scope: 'user', enabled: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: mutable\n---\nsecond');
    svc.clearCache({ removeFile: true });

    const second = await svc.scanSkills({ scope: 'user' });
    const updated = second.skills.find(skill => skill.controlKey === initial.controlKey);

    expect(updated.artifact.contentHash).not.toBe(initialHash);
    expect(updated.trust).toBe('needs_review');
    expect(updated.enabled).toBe(false);
    expect(fs.existsSync(path.join(svc.installDir, 'mutable'))).toBe(false);
  });
  it('takes ownership of a native target through its artifact and disables it safely', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const skillDir = path.join(svc.installDir, 'kept-artifact');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: kept-artifact\n---\nBody');

    const snapshot = await svc.scanSkills({ scope: 'user' });
    const skill = snapshot.skills.find(item => item.directory === 'kept-artifact');
    const artifactRoot = skill.artifact.root;

    const result = svc.controlService.setSkillEnabled({
      controlKey: skill.controlKey,
      scope: 'user',
      enabled: false
    });

    expect(result.enabled).toBe(false);
    expect(result.projection.state).toBe('disabled');
    expect(fs.existsSync(artifactRoot)).toBe(true);
    expect(fs.existsSync(skillDir)).toBe(false);
  });
  it('keeps project-local artifacts isolated by canonical project path', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const projectA = path.join(testDir, 'project-a');
    const projectB = path.join(testDir, 'project-b');
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });
    const files = [{ path: 'SKILL.md', content: '# Same directory' }];

    svc.createSkillWithFiles({ directory: 'same', files, scope: 'project', cwd: projectA });
    svc.createSkillWithFiles({ directory: 'same', files, scope: 'project', cwd: projectB });

    const artifacts = svc.artifactStore.list({ platform: 'claude' })
      .filter(artifact => artifact.sourceProvider === 'local' && artifact.directory === 'same');
    expect(artifacts).toHaveLength(2);
    expect(new Set(artifacts.map(artifact => artifact.sourceKey)).size).toBe(2);
    const userScan = await svc.scanSkills({ scope: 'user' });
    const projectAScan = await svc.scanSkills({ scope: 'project', cwd: projectA });
    const projectBScan = await svc.scanSkills({ scope: 'project', cwd: projectB });
    expect(userScan.skills.some(skill => skill.sourceScope === 'project' && skill.directory === 'same')).toBe(false);
    expect(projectAScan.skills.some(skill => skill.projectPath === fs.realpathSync(projectA))).toBe(true);
    expect(projectBScan.skills.some(skill => skill.projectPath === fs.realpathSync(projectB))).toBe(true);
  });

  it('project Skill overrides the same-directory user Skill', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    const projectRoot = path.join(testDir, 'precedence-project');
    const userSkill = path.join(svc.installDir, 'shared');
    const projectSkill = path.join(projectRoot, '.claude', 'skills', 'shared');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.mkdirSync(projectSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '---\\nname: Shared\\ndescription: user\\n---\\nUser');
    fs.writeFileSync(path.join(projectSkill, 'SKILL.md'), '---\\nname: Shared\\ndescription: project\\n---\\nProject');

    const result = await svc.scanSkills({ scope: 'project', cwd: projectRoot });
    const shared = result.skills.filter(skill => skill.directory === 'shared');

    expect(shared).toHaveLength(1);
    expect(shared[0].sourceScope).toBe('project');
    expect(shared[0].shadowedSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceScope: 'user' })
    ]));
  });
  it('keeps project Skill details scoped to the requested project', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const projectA = path.join(testDir, 'detail-project-a');
    const projectB = path.join(testDir, 'detail-project-b');
    const artifactA = path.join(testDir, 'artifacts', 'a');
    const artifactB = path.join(testDir, 'artifacts', 'b');
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });
    fs.mkdirSync(artifactA, { recursive: true });
    fs.mkdirSync(artifactB, { recursive: true });
    fs.writeFileSync(path.join(artifactA, 'SKILL.md'), '---\nname: same\n---\nProject A');
    fs.writeFileSync(path.join(artifactB, 'SKILL.md'), '---\nname: same\n---\nProject B');
    const svc = new SkillService('claude', {
      artifactStore: {
        list: vi.fn(() => [
          {
            sourceKey: 'project-a',
            sourceScope: 'project',
            projectPath: fs.realpathSync(projectA),
            directory: 'same',
            root: artifactA
          },
          {
            sourceKey: 'project-b',
            sourceScope: 'project',
            projectPath: fs.realpathSync(projectB),
            directory: 'same',
            root: artifactB
          }
        ])
      },
      controlService: {
        getSkill: vi.fn(() => null)
      }
    });
    svc.scanSkills = vi.fn(async () => ({ skills: [] }));

    const detail = await svc.getSkillDetail('same', null, 'same', {
      scope: 'project',
      cwd: projectA
    });

    expect(detail.fullContent).toContain('Project A');
    expect(detail.fullContent).not.toContain('Project B');
  });
});

describe('SkillService explicit remote refresh', () => {
  it('downloads every Skill in a repository and publishes a platform-specific artifact', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const controls = new Map();
    const svc = new SkillService('codex', {
      artifactStore: {
        publishSkill: vi.fn(async input => ({
          ...input.metadata,
          platform: input.platform,
          sourceKey: input.sourceKey,
          format: input.format,
          root: path.join(testDir, 'artifacts', input.sourceKey.replace(/[^a-z0-9]/gi, '_')),
          contentHash: 'b'.repeat(64),
          state: 'ready',
          fetchedAt: Date.now()
        }))
      },
      formatAdapter: {
        normalize: vi.fn(({ files }) => ({
          format: 'codex-skill-v1',
          files,
          warnings: []
        }))
      },
      controlService: {
        getSkill: vi.fn((controlKey, options) => controls.get(`${options.scope}:${controlKey}`) || null),
        registerSkill: vi.fn(entry => {
          controls.set(`${entry.scope}:${entry.controlKey}`, entry);
          return entry;
        })
      }
    });
    svc.loadRepos = vi.fn(() => [{
      id: 'github:owner/repo::main::',
      provider: 'github',
      owner: 'owner',
      name: 'repo',
      branch: 'main',
      enabled: true
    }]);
    svc.fetchRepoSkillBundles = vi.fn(async () => [
      {
        sourceKey: 'repo:github:owner/repo::main:::skills/one',
        directory: 'one',
        fullDirectory: 'skills/one',
        files: [{ relativePath: 'SKILL.md', content: 'one' }],
        metadata: { name: 'one', description: 'One', revision: 'commit-a' }
      },
      {
        sourceKey: 'repo:github:owner/repo::main:::skills/two',
        directory: 'two',
        fullDirectory: 'skills/two',
        files: [
          { relativePath: 'SKILL.md', content: 'two' },
          { relativePath: 'scripts/helper.sh', content: 'true' }
        ],
        metadata: { name: 'two', description: 'Two', revision: 'commit-a' }
      }
    ]);

    const result = await svc.refreshRemoteSkills({ platform: 'codex', scope: 'user' });

    expect(result).toEqual(expect.objectContaining({
      status: 'succeeded',
      fetchedRepos: 1,
      fetchedSkills: 2
    }));
    expect(svc.formatAdapter.normalize).toHaveBeenCalledTimes(2);
    expect(svc.artifactStore.publishSkill).toHaveBeenCalledTimes(2);
    expect([...controls.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ trust: 'needs_review', enabled: false, managed: true }),
      expect.objectContaining({ trust: 'needs_review', enabled: false, managed: true })
    ]));
  });

  it('stores project remote refreshes under the canonical project scope', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const projectPath = path.join(testDir, 'project-refresh');
    fs.mkdirSync(projectPath, { recursive: true });
    const controls = new Map();
    const svc = new SkillService('claude', {
      artifactStore: {
        publishSkill: vi.fn(async input => ({
          ...input.metadata,
          platform: input.platform,
          sourceKey: input.sourceKey,
          format: input.format,
          root: path.join(testDir, 'artifacts', 'project'),
          contentHash: 'c'.repeat(64),
          state: 'ready',
          fetchedAt: Date.now()
        }))
      },
      formatAdapter: {
        normalize: vi.fn(({ files }) => ({ format: 'claude-skill-v1', files, warnings: [] }))
      },
      controlService: {
        getSkill: vi.fn((controlKey, options) => controls.get(`${options.scope}:${options.projectPath || 'user'}:${controlKey}`) || null),
        registerSkill: vi.fn(entry => {
          controls.set(`${entry.scope}:${entry.projectPath || 'user'}:${entry.controlKey}`, entry);
          return entry;
        })
      }
    });
    svc.loadRepos = vi.fn(() => [{
      id: 'repo-project',
      provider: 'github',
      owner: 'owner',
      name: 'repo',
      branch: 'main',
      enabled: true
    }]);
    svc.fetchRepoSkillBundles = vi.fn(async () => [{
      sourceKey: 'repo:repo-project:skills/demo',
      directory: 'demo',
      fullDirectory: 'skills/demo',
      files: [{ relativePath: 'SKILL.md', content: 'demo' }],
      metadata: { name: 'demo', revision: 'commit-project' }
    }]);

    await svc.refreshRemoteSkills({
      platform: 'claude',
      scope: 'project',
      projectPath
    });

    const [entry] = [...controls.values()];
    expect(entry).toEqual(expect.objectContaining({
      scope: 'project',
      projectPath: fs.realpathSync(projectPath),
      trust: 'needs_review',
      enabled: false
    }));
    expect(entry.sourceKey).toContain(`:project:${fs.realpathSync(projectPath)}`);
    expect(svc.artifactStore.publishSkill).toHaveBeenCalledWith(expect.objectContaining({
      sourceKey: entry.sourceKey,
      metadata: expect.objectContaining({
        sourceScope: 'project',
        projectPath: fs.realpathSync(projectPath)
      })
    }));
  });

  it('preserves an approved enabled control entry when the artifact revision is unchanged', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const existing = {
      controlKey: 'skill:claude:user:user:repo:repo-1:skills/demo',
      kind: 'skill',
      platform: 'claude',
      scope: 'user',
      projectPath: null,
      sourceKey: 'repo:repo-1:skills/demo',
      source: { revision: 'commit-a' },
      artifact: { root: path.join(testDir, 'old'), contentHash: 'a'.repeat(64), state: 'ready' },
      targetDirectory: 'demo',
      cached: true,
      enabled: true,
      trust: 'approved',
      projection: { state: 'enabled', mode: 'native-copy' },
      managed: true
    };
    const registerSkill = vi.fn(entry => entry);
    const svc = new SkillService('claude', {
      artifactStore: {
        publishSkill: vi.fn(async input => ({
          ...input.metadata,
          platform: 'claude',
          sourceKey: input.sourceKey,
          format: input.format,
          root: path.join(testDir, 'new'),
          contentHash: existing.artifact.contentHash,
          state: 'ready'
        }))
      },
      formatAdapter: {
        normalize: vi.fn(({ files }) => ({ format: 'claude-skill-v1', files, warnings: [] }))
      },
      controlService: {
        getSkill: vi.fn(() => existing),
        registerSkill
      }
    });
    svc.loadRepos = vi.fn(() => [{ id: 'repo-1', provider: 'local', localPath: testDir, enabled: true }]);
    svc.fetchRepoSkillBundles = vi.fn(async () => [{
      sourceKey: 'repo:repo-1:skills/demo',
      directory: 'demo',
      fullDirectory: 'skills/demo',
      files: [{ relativePath: 'SKILL.md', content: 'demo' }],
      metadata: { name: 'demo', revision: 'commit-a' }
    }]);

    await svc.refreshRemoteSkills({ platform: 'claude', scope: 'user' });

    expect(registerSkill).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      trust: 'approved',
      projection: expect.objectContaining({ state: 'enabled' })
    }));
  });
});
