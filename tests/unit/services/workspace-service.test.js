const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

let testDir;
let workspacesFile;
let execFileSyncSpy;
let consoleErrorSpy;
let consoleWarnSpy;
let templateService;

function loadWorkspaceService() {
  delete require.cache[require.resolve('../../../src/server/services/workspace-service')];
  return require('../../../src/server/services/workspace-service');
}

function seedWorkspaces(data) {
  fs.mkdirSync(path.dirname(workspacesFile), { recursive: true });
  fs.writeFileSync(workspacesFile, JSON.stringify(data, null, 2), 'utf8');
}

function createRepo(name) {
  const repoPath = path.join(testDir, name);
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  return repoPath;
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-service-'));
  workspacesFile = path.join(testDir, 'config', 'workspaces.json');

  templateService = {
    applyTemplate: vi.fn(() => ({ template: 'Starter Template' }))
  };

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        workspaces: workspacesFile
      }
    }
  };

  const templateServicePath = require.resolve('../../../src/server/services/config-templates-service');
  require.cache[templateServicePath] = {
    id: templateServicePath,
    filename: templateServicePath,
    loaded: true,
    exports: templateService
  };

  execFileSyncSpy = vi.spyOn(childProcess, 'execFileSync').mockImplementation((command, args, options = {}) => {
    if (command !== 'git') return '';

    if (args[0] === 'rev-parse') {
      return 'feature/current\n';
    }

    if (args[0] === 'worktree' && args[1] === 'list') {
      return [
        `worktree ${options.cwd}`,
        'HEAD 1234567',
        'branch refs/heads/main',
        '',
        `worktree ${path.join(testDir, 'wt-feature')}`,
        'HEAD 89abcde',
        'branch refs/heads/feature/demo',
        ''
      ].join('\n');
    }

    if (args[0] === 'worktree' && args[1] === 'add') {
      return '';
    }

    if (args[0] === 'worktree' && args[1] === 'remove') {
      return '';
    }

    return '';
  });

  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  execFileSyncSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });

  [
    '../../../src/server/services/workspace-service',
    '../../../src/server/services/config-templates-service',
    '../../../src/server/services/sessions',
    '../../../src/server/services/codex-sessions',
    '../../../src/server/services/gemini-sessions',
    '../../../src/server/services/opencode-sessions',
    '../../../src/server/services/codex-config',
    '../../../src/server/services/gemini-config',
    '../../../src/config/loader',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('workspace-service config and git helpers', () => {
  test('loadWorkspaces falls back for blank and invalid config files', () => {
    const service = loadWorkspaceService();

    fs.mkdirSync(path.dirname(workspacesFile), { recursive: true });
    fs.writeFileSync(workspacesFile, '', 'utf8');
    expect(service.loadWorkspaces()).toEqual({ workspaces: [] });

    fs.writeFileSync(workspacesFile, '{bad json', 'utf8');
    expect(service.loadWorkspaces()).toEqual({ workspaces: [] });
  });

  test('getGitWorktrees parses porcelain output and excludes the main repository path', () => {
    const repoPath = createRepo('demo-repo');
    const service = loadWorkspaceService();

    const worktrees = service.getGitWorktrees(repoPath);

    expect(worktrees).toEqual([
      {
        path: path.join(testDir, 'wt-feature'),
        head: '89abcde',
        branch: 'refs/heads/feature/demo'
      }
    ]);
  });
});

describe('workspace-service workspace lifecycle', () => {
  test('createWorkspace creates git worktrees, applies template, and saves config', () => {
    const repoPath = createRepo('repo-a');
    const service = loadWorkspaceService();

    const workspace = service.createWorkspace({
      name: 'team-space',
      baseDir: testDir,
      projects: [{ sourcePath: repoPath, name: 'app' }],
      configTemplateId: 'starter'
    });

    expect(workspace).toMatchObject({
      name: 'team-space',
      path: path.join(testDir, 'team-space'),
      configTemplate: expect.objectContaining({
        templateId: 'starter',
        templateName: 'Starter Template'
      }),
      projects: [
        expect.objectContaining({
          name: 'app',
          sourcePath: repoPath,
          targetPath: path.join(testDir, 'team-space', 'app'),
          isGitRepo: true,
          useWorktree: true,
          worktrees: [{ branch: 'feature/current', path: path.join(testDir, 'team-space', 'app') }]
        })
      ]
    });
    expect(templateService.applyTemplate).toHaveBeenCalledWith(path.join(testDir, 'team-space'), 'starter');
    expect(execFileSyncSpy).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', path.join(testDir, 'team-space', 'app'), 'feature/current'],
      expect.objectContaining({ cwd: repoPath, encoding: 'utf8' })
    );
    expect(service.loadWorkspaces().workspaces).toHaveLength(1);
  });

  test('createWorkspace falls back to creating a new worktree branch when checkout fails', () => {
    const repoPath = createRepo('repo-b');
    const addCalls = [];
    execFileSyncSpy.mockImplementation((command, args) => {
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        addCalls.push([...args]);
        if (args[3] !== '-b') {
          throw new Error('branch not found');
        }
      }
      return '';
    });

    const service = loadWorkspaceService();
    service.createWorkspace({
      name: 'branch-space',
      baseDir: testDir,
      projects: [{
        sourcePath: repoPath,
        name: 'app',
        branch: 'feature/new',
        baseBranch: 'main'
      }]
    });

    expect(addCalls).toEqual([
      ['worktree', 'add', path.join(testDir, 'branch-space', 'app'), 'feature/new'],
      ['worktree', 'add', path.join(testDir, 'branch-space', 'app'), '-b', 'feature/new', 'main']
    ]);
  });

  test('deleteWorkspace unregisters worktrees, removes files, and updates config', () => {
    const repoPath = createRepo('repo-c');
    const workspacePath = path.join(testDir, 'workspace-c');
    const projectPath = path.join(workspacePath, 'app');
    fs.mkdirSync(projectPath, { recursive: true });
    seedWorkspaces({
      workspaces: [{
        id: 'ws-1',
        name: 'Workspace C',
        path: workspacePath,
        projects: [{
          name: 'app',
          sourcePath: repoPath,
          targetPath: projectPath,
          useWorktree: true
        }]
      }]
    });

    const service = loadWorkspaceService();
    const result = service.deleteWorkspace('ws-1', true);

    expect(result).toBe(true);
    expect(execFileSyncSpy).toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', projectPath, '--force'],
      expect.objectContaining({ cwd: repoPath })
    );
    expect(fs.existsSync(workspacePath)).toBe(false);
    expect(service.loadWorkspaces()).toEqual({ workspaces: [] });
  });
});

describe('workspace-service project management', () => {
  test('addProjectToWorkspace and removeProjectFromWorkspace manage non-git linked projects', () => {
    const workspacePath = path.join(testDir, 'workspace-links');
    const sourcePath = path.join(testDir, 'docs-source');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(sourcePath, { recursive: true });
    seedWorkspaces({
      workspaces: [{
        id: 'ws-1',
        name: 'Workspace Links',
        path: workspacePath,
        projects: []
      }]
    });

    const symlinkSpy = vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {});
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const service = loadWorkspaceService();

    const updatedWorkspace = service.addProjectToWorkspace('ws-1', {
      sourcePath,
      name: 'docs'
    });

    expect(updatedWorkspace.projects).toContainEqual(expect.objectContaining({
      name: 'docs',
      sourcePath,
      targetPath: sourcePath,
      isGitRepo: false,
      useWorktree: false
    }));
    expect(symlinkSpy).toHaveBeenCalledWith(sourcePath, path.join(workspacePath, 'docs'), 'dir');

    fs.writeFileSync(path.join(workspacePath, 'docs'), 'placeholder', 'utf8');
    const afterRemoval = service.removeProjectFromWorkspace('ws-1', 'docs');

    expect(unlinkSpy).toHaveBeenCalledWith(path.join(workspacePath, 'docs'));
    expect(afterRemoval.projects).toEqual([]);

    symlinkSpy.mockRestore();
    unlinkSpy.mockRestore();
  });

  test('getAllAvailableProjects merges installed channels and sorts by last use', async () => {
    const gitProjectPath = createRepo('claude-project');
    const codexProjectPath = path.join(testDir, 'codex-project');
    const opencodeProjectPath = path.join(testDir, 'opencode-project');
    fs.mkdirSync(codexProjectPath, { recursive: true });
    fs.mkdirSync(opencodeProjectPath, { recursive: true });

    const loaderPath = require.resolve('../../../src/config/loader');
    require.cache[loaderPath] = {
      id: loaderPath,
      filename: loaderPath,
      loaded: true,
      exports: {
        loadConfig: vi.fn(() => ({ theme: 'light' }))
      }
    };

    const sessionsPath = require.resolve('../../../src/server/services/sessions');
    require.cache[sessionsPath] = {
      id: sessionsPath,
      filename: sessionsPath,
      loaded: true,
      exports: {
        getProjectsWithStats: vi.fn(async () => [
          { name: 'claude-project', fullPath: gitProjectPath, lastUsed: 1000, sessionCount: 1 }
        ])
      }
    };

    const codexSessionsPath = require.resolve('../../../src/server/services/codex-sessions');
    require.cache[codexSessionsPath] = {
      id: codexSessionsPath,
      filename: codexSessionsPath,
      loaded: true,
      exports: {
        getProjects: vi.fn(() => [
          { name: 'codex-project', fullPath: codexProjectPath, lastUpdated: 5000, sessionCount: 2 }
        ])
      }
    };

    const geminiSessionsPath = require.resolve('../../../src/server/services/gemini-sessions');
    require.cache[geminiSessionsPath] = {
      id: geminiSessionsPath,
      filename: geminiSessionsPath,
      loaded: true,
      exports: {
        getProjects: vi.fn(() => [{ name: 'gemini-project', fullPath: path.join(testDir, 'gemini') }])
      }
    };

    const opencodeSessionsPath = require.resolve('../../../src/server/services/opencode-sessions');
    require.cache[opencodeSessionsPath] = {
      id: opencodeSessionsPath,
      filename: opencodeSessionsPath,
      loaded: true,
      exports: {
        getProjects: vi.fn(() => [
          { name: 'opencode-project', fullPath: opencodeProjectPath, lastUpdated: 9000, sessionCount: 3 }
        ]),
        isOpenCodeInstalled: vi.fn(() => true)
      }
    };

    const codexConfigPath = require.resolve('../../../src/server/services/codex-config');
    require.cache[codexConfigPath] = {
      id: codexConfigPath,
      filename: codexConfigPath,
      loaded: true,
      exports: {
        isCodexInstalled: vi.fn(() => true)
      }
    };

    const geminiConfigPath = require.resolve('../../../src/server/services/gemini-config');
    require.cache[geminiConfigPath] = {
      id: geminiConfigPath,
      filename: geminiConfigPath,
      loaded: true,
      exports: {
        isGeminiInstalled: vi.fn(() => false)
      }
    };

    const service = loadWorkspaceService();
    const projects = await service.getAllAvailableProjects();

    expect(projects.map((project) => project.channel)).toEqual(['opencode', 'codex', 'claude']);
    expect(projects).toContainEqual(expect.objectContaining({
      name: 'claude-project',
      channel: 'claude',
      isGitRepo: true
    }));
    expect(projects).toContainEqual(expect.objectContaining({
      name: 'codex-project',
      channel: 'codex',
      sessionCount: 2
    }));
  });

  test('getLaunchCommand returns project cwd and rejects unsupported tools', () => {
    const workspacePath = path.join(testDir, 'workspace-launch');
    const projectPath = path.join(workspacePath, 'app');
    fs.mkdirSync(projectPath, { recursive: true });
    seedWorkspaces({
      workspaces: [{
        id: 'ws-1',
        name: 'Workspace Launch',
        path: workspacePath,
        projects: [{
          name: 'app',
          sourcePath: projectPath,
          targetPath: projectPath
        }]
      }]
    });

    const service = loadWorkspaceService();

    expect(service.getLaunchCommand('ws-1', 'codex', 'app')).toEqual({
      command: 'codex',
      cwd: projectPath,
      workspaceName: 'Workspace Launch',
      projectName: 'app'
    });
    expect(() => service.getLaunchCommand('ws-1', 'unknown')).toThrow('不支持的工具: unknown');
  });
});
