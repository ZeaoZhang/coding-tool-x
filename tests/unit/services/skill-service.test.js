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
        localSkills: {
          claude:   path.join(testDir, 'local', 'claude'),
          codex:    path.join(testDir, 'local', 'codex'),
          gemini:   path.join(testDir, 'local', 'gemini'),
          opencode: path.join(testDir, 'local', 'opencode'),
          omp: path.join(testDir, 'local', 'omp')
        },
        skillRepos: {
          claude:   path.join(testDir, 'repos', 'claude.json'),
          codex:    path.join(testDir, 'repos', 'codex.json'),
          gemini:   path.join(testDir, 'repos', 'gemini.json'),
          opencode: path.join(testDir, 'repos', 'opencode.json'),
          omp: path.join(testDir, 'repos', 'omp.json')
        },
        skillCaches: {
          claude:   path.join(testDir, 'cache', 'claude.json'),
          codex:    path.join(testDir, 'cache', 'codex.json'),
          gemini:   path.join(testDir, 'cache', 'gemini.json'),
          opencode: path.join(testDir, 'cache', 'opencode.json'),
          omp: path.join(testDir, 'cache', 'omp.json')
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
      })
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
  delete require.cache[require.resolve('../../../src/server/services/skill-service')];
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete require.cache[require.resolve('../../../src/server/services/skill-service')];
  delete require.cache[require.resolve('../../../src/config/paths')];
  delete require.cache[require.resolve('../../../src/server/services/omp-config')];
  delete require.cache[require.resolve('../../../src/server/services/omp-skill-discovery')];
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

  it('OMP keeps the highest-priority provider by name and reports shadowed sources', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    const nativeRoot = path.join(ompRuntimeDir, 'skills', 'shared');
    const claudeRoot = path.join(testDir, 'claude-skills', 'shared');
    fs.mkdirSync(nativeRoot, { recursive: true });
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(nativeRoot, 'SKILL.md'),
      '---\nname: shared\ndescription: Native wins\n---\nBody'
    );
    fs.writeFileSync(
      path.join(claudeRoot, 'SKILL.md'),
      '---\nname: shared\n---\nExternal body'
    );

    const skills = await svc.listSkills(true);

    expect(skills).toHaveLength(1);
    expect(skills[0].sourceProvider).toBe('native');
    expect(skills[0].shadowedSources).toEqual([
      expect.objectContaining({ sourceProvider: 'claude', sourceScope: 'user' })
    ]);
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

  it('OMP honors provider toggles plus include and ignore skill settings', async () => {
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
    expect(await svc.listSkills(true)).toEqual([]);
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

describe('SkillService cache scheduling', () => {
  it('uses a fresh prepared cache before loading the disk cache', async () => {
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
    const loadCache = vi.spyOn(svc, 'loadCacheFromFile');
    const fetchRepos = vi.spyOn(svc, 'fetchRepoSkills');

    const result = await svc.listSkills(false);

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'prepared' })
    ]));
    expect(loadCache).not.toHaveBeenCalled();
    expect(fetchRepos).not.toHaveBeenCalled();
  });

  it('coalesces concurrent forced remote refreshes', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('claude');
    svc.loadRepos = vi.fn(() => [{
      provider: 'github',
      owner: 'owner',
      name: 'repo',
      branch: 'main',
      enabled: true
    }]);
    let resolveFetch;
    const fetchResult = new Promise(resolve => {
      resolveFetch = resolve;
    });
    const fetchRepos = vi.spyOn(svc, 'fetchRepoSkills').mockReturnValue(fetchResult);

    const first = svc.listSkills(true);
    const second = svc.listSkills(true);
    await Promise.resolve();

    expect(fetchRepos).toHaveBeenCalledTimes(1);
    resolveFetch([]);
    await Promise.all([first, second]);
  });
});
describe('OMP discovery cache', () => {
  it('reuses settings and plugin path CLI results for the same cwd', () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const { discoverOmpSkills } = require('../../../src/server/services/omp-skill-discovery');
    const svc = new SkillService('omp');
    const ompConfig = require('../../../src/server/services/omp-config');
    const cwd = path.join(testDir, 'project');
    fs.mkdirSync(cwd, { recursive: true });

    discoverOmpSkills(svc, { cwd });
    discoverOmpSkills(svc, { cwd });

    expect(ompConfig.getOmpCommand).toHaveBeenCalledTimes(2);
  });
  it('coalesces concurrent OMP lists by cwd while refreshing remote skills once', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('omp');
    svc.loadRepos = vi.fn(() => [{
      provider: 'github',
      owner: 'owner',
      name: 'omp-repo',
      branch: 'main',
      enabled: true
    }]);
    let resolveFetch;
    const fetchResult = new Promise(resolve => {
      resolveFetch = resolve;
    });
    const fetchRepos = vi.spyOn(svc, 'fetchRepoSkills').mockReturnValue(fetchResult);
    const cwd = path.join(testDir, 'omp-project');
    fs.mkdirSync(cwd, { recursive: true });

    const requests = Array.from({ length: 20 }, () => svc.listSkills(false, { cwd }));
    await Promise.resolve();

    expect(fetchRepos).toHaveBeenCalledTimes(1);
    resolveFetch([]);
    await Promise.all(requests);
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
});

describe('SkillService project scope', () => {
  it('installs and lists a Skill in the project canonical directory', async () => {
    const { SkillService } = require('../../../src/server/services/skill-service');
    const svc = new SkillService('codex');
    const projectRoot = path.join(testDir, 'project-scope');
    fs.mkdirSync(projectRoot, { recursive: true });
    const repoRoot = path.join(testDir, 'skill-repo');
    fs.mkdirSync(path.join(repoRoot, 'repo-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'repo-skill', 'SKILL.md'),
      '---\nname: Repo Skill\ndescription: Project skill\n---\nBody',
      'utf8'
    );

    await svc.installSkill(
      'repo-skill',
      { provider: 'local', localPath: repoRoot, id: 'local:repo' },
      null,
      { scope: 'project', cwd: projectRoot }
    );

    expect(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'repo-skill', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'codex-skills', 'repo-skill'))).toBe(false);

    const skills = await svc.listSkills(true, { scope: 'project', cwd: projectRoot });
    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        directory: 'repo-skill',
        sourceScope: 'project',
        installed: true
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
      `project:${path.resolve(projectRoot)}`
    ]));
  });
});
