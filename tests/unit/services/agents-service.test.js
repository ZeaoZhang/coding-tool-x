const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('toml');

let testDir;
let installFromRepoMock;
let uninstallMock;
let loadReposMock;
let addRepoMock;
let removeRepoMock;
let toggleRepoMock;
let listRemoteItemsMock;
let AgentsService;

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-service-'));

  installFromRepoMock = vi.fn(async (repoPath, repo, targetName) => ({
    success: true,
    repoPath,
    repo,
    targetName
  }));
  uninstallMock = vi.fn((targetName) => ({
    success: true,
    targetName
  }));
  loadReposMock = vi.fn(() => [{ owner: 'demo', name: 'agents', branch: 'main', enabled: true }]);
  addRepoMock = vi.fn((repo) => [repo]);
  removeRepoMock = vi.fn(() => []);
  toggleRepoMock = vi.fn((_owner, _name, _directory, enabled) => [{ enabled }]);
  listRemoteItemsMock = vi.fn(async () => [{
    fileName: 'remote-agent',
    name: 'Remote Agent',
    repoPath: 'agents/remote-agent.md',
    repoOwner: 'demo',
    repoName: 'agents',
    repoBranch: 'main'
  }]);

  class RepoScannerBaseStub {
    constructor(options) {
      this.type = options.type;
      this.installDir = options.installDir;
      this.defaultRepos = options.defaultRepos || [];
    }

    loadRepos() {
      return loadReposMock();
    }

    addRepo(repo) {
      return addRepoMock(repo);
    }

    removeRepo(owner, name, directory = '') {
      return removeRepoMock(owner, name, directory);
    }

    toggleRepo(owner, name, directory = '', enabled) {
      return toggleRepoMock(owner, name, directory, enabled);
    }

    listRemoteItems(forceRefresh) {
      return listRemoteItemsMock(forceRefresh);
    }

    installFromRepo(repoPath, repo, targetName) {
      return installFromRepoMock(repoPath, repo, targetName);
    }

    uninstall(targetName) {
      return uninstallMock(targetName);
    }
  }

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        claude: {
          settings: path.join(testDir, '.claude', 'settings.json')
        },
        codex: {
          config: path.join(testDir, '.codex', 'config.toml')
        },
        opencode: {
          config: path.join(testDir, '.config', 'opencode')
        }
      }
    }
  };

  const homeDirModulePath = require.resolve('../../../src/utils/home-dir');
  require.cache[homeDirModulePath] = {
    id: homeDirModulePath,
    filename: homeDirModulePath,
    loaded: true,
    exports: {
      resolvePreferredHomeDir: vi.fn(() => testDir)
    }
  };

  const repoScannerPath = require.resolve('../../../src/server/services/repo-scanner-base');
  require.cache[repoScannerPath] = {
    id: repoScannerPath,
    filename: repoScannerPath,
    loaded: true,
    exports: {
      RepoScannerBase: RepoScannerBaseStub
    }
  };

  delete require.cache[require.resolve('../../../src/server/services/agents-service')];
  ({ AgentsService } = require('../../../src/server/services/agents-service'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/agents-service',
    '../../../src/config/paths',
    '../../../src/utils/home-dir',
    '../../../src/server/services/repo-scanner-base'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('AgentsService local file management', () => {
  test('creates, lists, reads, and deletes claude user and project agents', () => {
    const projectPath = path.join(testDir, 'project-a');
    fs.mkdirSync(projectPath, { recursive: true });
    const service = new AgentsService('claude');

    const userAgent = service.createAgent({
      fileName: 'reviewer',
      scope: 'user',
      name: 'Reviewer',
      description: 'Reviews code',
      tools: 'read,write',
      model: 'claude-3',
      permissionMode: 'acceptEdits',
      skills: 'debug',
      systemPrompt: 'Review everything'
    });
    const projectAgent = service.createAgent({
      fileName: 'local-helper',
      scope: 'project',
      projectPath,
      name: 'Local Helper',
      description: 'Project specific',
      systemPrompt: 'Help locally'
    });

    const listed = service.listAgents(projectPath);
    const loaded = service.getAgent('reviewer', 'user');

    expect(userAgent).toEqual(expect.objectContaining({
      fileName: 'reviewer',
      description: 'Reviews code',
      model: 'claude-3',
      systemPrompt: 'Review everything'
    }));
    expect(projectAgent.scope).toBe('project');
    expect(listed.total).toBe(2);
    expect(listed.userCount).toBe(1);
    expect(listed.projectCount).toBe(1);
    expect(loaded).toEqual(expect.objectContaining({
      tools: 'read,write',
      permissionMode: 'acceptEdits',
      skills: 'debug'
    }));

    expect(service.deleteAgent('reviewer', 'user')).toEqual({
      success: true,
      message: '代理已删除'
    });
    expect(service.getAgent('reviewer', 'user')).toBeNull();
  });
});

describe('AgentsService remote repo operations', () => {
  test('delegates repo management and remote installation with path validation', async () => {
    const service = new AgentsService('claude');
    writeFile(path.join(service.userAgentsDir, 'installed-local.md'), 'body');

    const allAgents = await service.listAllAgents();
    expect(allAgents.total).toBe(2);
    expect(allAgents.remoteCount).toBe(1);
    expect(service.getRepos()).toEqual([{ owner: 'demo', name: 'agents', branch: 'main', enabled: true }]);
    expect(service.addRepo({ owner: 'extra', name: 'repo', branch: 'main', enabled: true })).toEqual([
      { owner: 'extra', name: 'repo', branch: 'main', enabled: true }
    ]);
    expect(service.toggleRepo('demo', 'agents', '', false)).toEqual([{ enabled: false }]);

    await expect(service.installFromRemote({
      fileName: 'remote-agent',
      repoPath: '../escape.md',
      repoOwner: 'demo',
      repoName: 'agents',
      repoBranch: 'main'
    })).rejects.toThrow('代理仓库路径不合法');

    const installResult = await service.installFromRemote({
      fileName: 'remote-agent',
      repoPath: 'agents/remote-agent.md',
      repoOwner: 'demo',
      repoName: 'agents',
      repoBranch: 'main'
    });

    expect(installResult).toEqual({
      success: true,
      repoPath: 'agents/remote-agent.md',
      repo: { owner: 'demo', name: 'agents', branch: 'main' },
      targetName: 'remote-agent.md'
    });
    expect(service.uninstallAgent('remote-agent')).toEqual({
      success: true,
      targetName: 'remote-agent.md'
    });
  });
});

describe('AgentsService codex mode', () => {
  test('creates, updates, and deletes codex agents with managed config files', () => {
    const service = new AgentsService('codex');

    const created = service.createAgent({
      fileName: 'assistant',
      scope: 'user',
      description: 'Assist coding',
      model: 'gpt-4o'
    });

    const codexConfigPath = path.join(testDir, '.codex', 'config.toml');
    const managedConfigPath = path.join(testDir, '.codex', 'agents', 'assistant.toml');
    const parsedCreatedConfig = toml.parse(fs.readFileSync(codexConfigPath, 'utf8'));

    expect(created).toEqual(expect.objectContaining({
      fileName: 'assistant',
      description: 'Assist coding',
      model: 'gpt-4o',
      configMode: 'managed',
      configFile: managedConfigPath
    }));
    expect(parsedCreatedConfig.features.multi_agent).toBe(true);
    expect(parsedCreatedConfig.agents.assistant.description).toBe('Assist coding');
    expect(parsedCreatedConfig.agents.assistant.config_file).toBe(managedConfigPath);
    expect(toml.parse(fs.readFileSync(managedConfigPath, 'utf8')).model).toBe('gpt-4o');

    const updated = service.updateAgent({
      fileName: 'assistant',
      scope: 'user',
      description: 'Assist coding better',
      configMode: 'none'
    });
    const parsedUpdatedConfig = toml.parse(fs.readFileSync(codexConfigPath, 'utf8'));

    expect(updated).toEqual(expect.objectContaining({
      description: 'Assist coding better',
      configMode: 'none',
      model: ''
    }));
    expect(parsedUpdatedConfig.agents.assistant.description).toBe('Assist coding better');
    expect(parsedUpdatedConfig.agents.assistant.config_file).toBeUndefined();
    expect(fs.existsSync(managedConfigPath)).toBe(false);

    expect(service.deleteAgent('assistant', 'user')).toEqual({
      success: true,
      message: '代理已删除'
    });
    expect(service.getAgent('assistant', 'user')).toBeNull();
  });
});
