const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let repoScannerState;

function stubModules() {
  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        claude: { settings: path.join(testDir, 'claude-settings.json') },
        gemini: { dir: path.join(testDir, '.gemini') },
        opencode: { config: path.join(testDir, 'opencode-config') }
      }
    }
  };

  const formatConverterPath = require.resolve('../../../src/server/services/format-converter');
  require.cache[formatConverterPath] = {
    id: formatConverterPath,
    filename: formatConverterPath,
    loaded: true,
    exports: {
      parseFrontmatter: (content = '') => {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
        const frontmatter = {};
        const body = match ? match[2] : content;
        if (match) {
          for (const line of match[1].split('\n')) {
            const idx = line.indexOf(':');
            if (idx > -1) {
              const key = line.slice(0, idx).trim();
              let value = line.slice(idx + 1).trim();
              value = value.replace(/^"|"$/g, '');
              if (value === 'true') value = true;
              if (value === 'false') value = false;
              frontmatter[key] = value;
            }
          }
        }
        return { frontmatter, body };
      }
    }
  };

  repoScannerState = {
    remoteItems: [],
    repos: [],
    uninstalled: [],
    installed: []
  };

  const repoScannerBasePath = require.resolve('../../../src/server/services/repo-scanner-base');
  class RepoScannerBaseStub {
    constructor(options = {}) {
      this.installDir = options.installDir;
      this.options = options;
    }

    loadRepos() {
      return repoScannerState.repos;
    }

    addRepo(repo) {
      repoScannerState.repos.push(repo);
      return repoScannerState.repos;
    }

    removeRepo(owner, name, directory = '') {
      repoScannerState.repos = repoScannerState.repos.filter((repo) =>
        !(repo.owner === owner && repo.name === name && (repo.directory || '') === directory)
      );
      return repoScannerState.repos;
    }

    toggleRepo(owner, name, directory = '', enabled) {
      const repo = repoScannerState.repos.find((item) =>
        item.owner === owner && item.name === name && (item.directory || '') === directory
      );
      if (repo) repo.enabled = enabled;
      return repoScannerState.repos;
    }

    async listRemoteItems() {
      return repoScannerState.remoteItems;
    }

    parseFrontmatter(content = '') {
      return require('../../../src/server/services/format-converter').parseFrontmatter(content);
    }

    uninstall(relativePath) {
      repoScannerState.uninstalled.push(relativePath);
      return { success: true, removed: relativePath };
    }

    async installCommand(command) {
      repoScannerState.installed.push(command);
      return { success: true, installed: command.path };
    }

    installFromRepo(repoPath, repo, relativePath) {
      return { repoPath, repo, relativePath };
    }
  }
  require.cache[repoScannerBasePath] = {
    id: repoScannerBasePath,
    filename: repoScannerBasePath,
    loaded: true,
    exports: {
      RepoScannerBase: RepoScannerBaseStub
    }
  };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commands-service-'));
  stubModules();
  delete require.cache[require.resolve('../../../src/server/services/commands-service')];
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/commands-service',
    '../../../src/config/paths',
    '../../../src/server/services/format-converter',
    '../../../src/server/services/repo-scanner-base'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('CommandsService local command management', () => {
  test('creates, lists, updates and deletes a Claude command with namespace', () => {
    const { CommandsService } = require('../../../src/server/services/commands-service');
    const service = new CommandsService('claude');
    const projectPath = path.join(testDir, 'project');
    const created = service.createCommand({
      name: 'review',
      scope: 'user',
      namespace: 'team',
      description: 'Review code',
      allowedTools: 'Read,Edit',
      argumentHint: 'ticket',
      agent: 'reviewer',
      model: 'gpt-4.1',
      subtask: true,
      body: 'Run review'
    });

    expect(created.path).toBe(path.join('team', 'review.md'));
    expect(created.allowedTools).toBe('Read,Edit');

    const listed = service.listCommands(projectPath);
    expect(listed.total).toBe(1);
    expect(listed.userCount).toBe(1);

    const updated = service.updateCommand({
      name: 'review',
      scope: 'user',
      namespace: 'team',
      description: 'Updated review',
      body: 'New body'
    });
    expect(updated.description).toBe('Updated review');
    expect(updated.body).toBe('New body');

    const deleted = service.deleteCommand('review', 'user', null, 'team');
    expect(deleted.success).toBe(true);
    expect(service.getCommand('review', 'user', null, 'team')).toBeNull();
  });

  test('rejects invalid command names and existing commands', () => {
    const { CommandsService } = require('../../../src/server/services/commands-service');
    const service = new CommandsService('claude');

    expect(() => service.createCommand({ name: 'bad name', scope: 'user' })).toThrow(/命令名/);

    service.createCommand({ name: 'review', scope: 'user' });
    expect(() => service.createCommand({ name: 'review', scope: 'user' })).toThrow(/已存在/);
  });

  test('OpenCode commands omit Claude-specific frontmatter fields', () => {
    const { CommandsService } = require('../../../src/server/services/commands-service');
    const service = new CommandsService('opencode');
    const command = service.createCommand({
      name: 'format',
      scope: 'user',
      allowedTools: 'Read,Edit',
      argumentHint: 'file',
      body: 'format file'
    });

    expect(command.allowedTools).toBe('');
    expect(command.argumentHint).toBe('');
    expect(fs.readFileSync(command.fullPath, 'utf8')).not.toContain('allowed-tools');
  });

  test('Gemini commands use TOML files in user and project scopes', () => {
    const { CommandsService } = require('../../../src/server/services/commands-service');
    const service = new CommandsService('gemini');
    const projectPath = path.join(testDir, 'project-gemini');

    const created = service.createCommand({
      name: 'review',
      scope: 'user',
      description: 'Review code',
      allowedTools: 'Read,Edit',
      argumentHint: 'file',
      body: 'Review this'
    });
    const projectCommand = service.createCommand({
      name: 'local',
      scope: 'project',
      projectPath,
      namespace: 'team',
      description: 'Local review',
      body: 'Review locally'
    });

    expect(created.path).toBe('review.toml');
    expect(created.description).toBe('Review code');
    expect(created.body).toBe('Review this');
    expect(created.allowedTools).toBe('');
    expect(fs.readFileSync(created.fullPath, 'utf8')).toContain('prompt = "Review this"');
    expect(fs.readFileSync(created.fullPath, 'utf8')).not.toContain('allowed-tools');
    expect(projectCommand.path).toBe(path.join('team', 'local.toml'));

    const listed = service.listCommands(projectPath);
    expect(listed.total).toBe(2);
    expect(listed.projectCount).toBe(1);

    const deleted = service.deleteCommand('local', 'project', projectPath, 'team');
    expect(deleted.success).toBe(true);
    expect(service.getCommand('local', 'project', projectPath, 'team')).toBeNull();
  });
});

describe('CommandsService remote merge and stats', () => {
  test('listAllCommands merges remote commands without duplicating local ones', async () => {
    const { CommandsService } = require('../../../src/server/services/commands-service');
    const service = new CommandsService('claude');

    service.createCommand({ name: 'review', scope: 'user', body: 'local' });
    repoScannerState.remoteItems = [
      { name: 'review', namespace: null, path: 'review.md' },
      { name: 'lint', namespace: null, path: 'lint.md' }
    ];

    const result = await service.listAllCommands(null, true);

    expect(result.total).toBe(2);
    expect(result.remoteCount).toBe(2);
    expect(result.commands.map((command) => command.name)).toEqual(['lint', 'review']);
  });

  test('getStats groups commands by namespace', () => {
    const { CommandsService } = require('../../../src/server/services/commands-service');
    const service = new CommandsService('claude');
    service.createCommand({ name: 'review', scope: 'user', namespace: 'team' });
    service.createCommand({ name: 'build', scope: 'user' });

    const stats = service.getStats();

    expect(stats.total).toBe(2);
    expect(stats.namespaces.team).toBe(1);
    expect(stats.namespaces['(root)']).toBe(1);
  });

  test('Gemini remote command parser reads TOML metadata and body', async () => {
    const { CommandsService } = require('../../../src/server/services/commands-service');
    const service = new CommandsService('gemini');
    const repo = { owner: 'google-gemini', name: 'gemini-cli', branch: 'main' };
    const file = { path: '.gemini/commands/team/review.toml' };

    service.repoScanner.fetchRawContent = vi.fn(async () => 'description = "Review code"\nprompt = "Check this change"\n');

    const item = await service.repoScanner.fetchAndParseItem(file, repo, '.gemini/commands');

    expect(item).toEqual(expect.objectContaining({
      name: 'review',
      namespace: 'team',
      path: path.join('team', 'review.toml'),
      description: 'Review code',
      body: 'Check this change',
      repoPath: '.gemini/commands/team/review.toml'
    }));
    expect(item.readmeUrl).toContain('google-gemini/gemini-cli');
  });

  test('repo management delegates to scanner', async () => {
    const { CommandsService } = require('../../../src/server/services/commands-service');
    const service = new CommandsService('claude');

    service.addRepo({ owner: 'demo', name: 'repo', directory: 'commands' });
    service.toggleRepo('demo', 'repo', 'commands', false);
    const installResult = await service.installFromRemote({ path: 'review.md' });
    const uninstallResult = service.uninstallCommand('review.md');

    expect(service.getRepos()[0].enabled).toBe(false);
    expect(installResult).toEqual({
      repoPath: undefined,
      repo: { owner: undefined, name: undefined, branch: undefined },
      relativePath: 'review.md'
    });
    expect(uninstallResult).toEqual({ success: true, removed: 'review.md' });
  });
});
