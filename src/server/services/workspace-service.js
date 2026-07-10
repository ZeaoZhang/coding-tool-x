// 多项目工作区服务
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PATHS } = require('../../config/paths');
const configTemplatesService = require('./config-templates-service');

// 工作区配置文件路径
const WORKSPACES_CONFIG = PATHS.workspaces;

function createSymlink(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, 'dir');
  } catch (err) {
    if (err.code === 'EPERM' && process.platform === 'win32') {
      throw new Error(
        `创建软链接失败：Windows 需要管理员权限或开启开发者模式。\n` +
        `解决方案：\n` +
        `1. 以管理员身份运行终端后重试\n` +
        `2. 或开启开发者模式：设置 → 系统 → 开发者选项 → 开发者模式\n` +
        `3. 对于 Git 项目，建议保持默认的 worktree 模式（无需软链接）\n` +
        `原始错误: ${err.message}`
      );
    }
    throw err;
  }
}

function runGitCommand(args, options = {}) {
  const execOptions = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...options
  };
  return execFileSync('git', args, execOptions);
}

function resolveCurrentBranch(repoPath) {
  try {
    return runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoPath
    }).trim();
  } catch (error) {
    return 'main';
  }
}

/**
 * 生成唯一工作区 ID
 */
function generateWorkspaceId() {
  return `workspace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 加载工作区配置
 */
function loadWorkspaces() {
  try {
    if (fs.existsSync(WORKSPACES_CONFIG)) {
      const content = fs.readFileSync(WORKSPACES_CONFIG, 'utf8');
      // 处理空文件或无效内容
      if (!content || content.trim() === '') {
        return { workspaces: [] };
      }
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('加载工作区配置失败:', error.message);
  }
  return { workspaces: [] };
}

/**
 * 保存工作区配置
 */
function saveWorkspaces(data) {
  try {
    const dir = path.dirname(WORKSPACES_CONFIG);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(WORKSPACES_CONFIG, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('保存工作区配置失败:', error.message);
    return false;
  }
}

/**
 * 获取所有工作区列表
 */
function listWorkspaces() {
  const data = loadWorkspaces();
  return data.workspaces.map(ws => ({
    ...ws,
    exists: fs.existsSync(ws.path),
    projectCount: ws.projects.length
  }));
}

/**
 * 获取单个工作区详情
 */
function getWorkspace(id) {
  const data = loadWorkspaces();
  const workspace = data.workspaces.find(ws => ws.id === id);
  if (!workspace) {
    return null;
  }

  // 检查工作区目录是否存在
  workspace.exists = fs.existsSync(workspace.path);

  // 检查每个项目链接是否有效
  workspace.projects = workspace.projects.map(proj => ({
    ...proj,
    linkExists: fs.existsSync(path.join(workspace.path, proj.name)),
    sourceExists: fs.existsSync(proj.sourcePath)
  }));

  return workspace;
}

/**
 * 检查目录是否是 git 仓库
 */
function isGitRepo(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return false;
    }
    const gitDir = path.join(dirPath, '.git');
    return fs.existsSync(gitDir);
  } catch (error) {
    return false;
  }
}

/**
 * 获取 git 仓库的所有 worktree
 */
function getGitWorktrees(repoPath) {
  try {
    if (!isGitRepo(repoPath)) {
      return [];
    }
    const output = runGitCommand(['worktree', 'list', '--porcelain'], {
      cwd: repoPath
    });

    const worktrees = [];
    const lines = output.split('\n');
    let current = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current);
        }
        current = { path: line.substring(9) };
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7);
      } else if (line.startsWith('HEAD ')) {
        current.head = line.substring(5);
      }
    }

    if (current.path) {
      worktrees.push(current);
    }

    return worktrees.filter(wt => wt.path !== repoPath); // 排除主仓库
  } catch (error) {
    console.error('获取 worktree 列表失败:', error.message);
    return [];
  }
}

/**
 * 创建多项目工作区
 * @param {Object} options - 创建选项
 * @param {string} options.name - 工作区名称
 * @param {string} options.description - 工作区描述
 * @param {string} options.baseDir - 基础目录（可选）
 * @param {Array} options.projects - 项目列表 [{sourcePath, name, createWorktree, branch}]
 */
function createWorkspace(options) {
  const { name, description = '', baseDir, projects = [], configTemplateId } = options;

  if (!name || name.trim() === '') {
    throw new Error('工作区名称不能为空');
  }

  if (projects.length === 0) {
    throw new Error('至少需要选择一个项目');
  }

  // 确定工作区路径
  let workspacePath;
  if (baseDir && baseDir.trim() !== '') {
    workspacePath = path.resolve(baseDir, name);
  } else {
    // 默认：第一个项目的父目录
    const firstProject = projects[0];
    const firstProjectParent = path.dirname(firstProject.sourcePath);
    workspacePath = path.join(firstProjectParent, name);
  }

  // 检查工作区目录是否已存在
  if (fs.existsSync(workspacePath)) {
    throw new Error(`目录已存在: ${workspacePath}`);
  }

  // 创建工作区目录
  fs.mkdirSync(workspacePath, { recursive: true });

  const workspaceProjects = [];

  /**
   * 验证 worktree 分支冲突
   * @param {Array} projects - 项目列表
   * @returns {Array} 冲突列表 [{repo, branch, projects: [index1, index2]}]
   */
  function validateWorktreeBranches(projects) {
    const repoMap = new Map();
    const conflicts = [];

    for (let i = 0; i < projects.length; i++) {
      const proj = projects[i];
      const { sourcePath, branch, createWorktree } = proj;

      // Skip non-worktree projects
      const isGit = isGitRepo(sourcePath);
      const useWorktree = createWorktree !== undefined ? createWorktree : isGit;
      if (!useWorktree || !isGit) continue;

      // Resolve to absolute path to handle symlinks
      const resolvedPath = fs.realpathSync(sourcePath);

      // Determine target branch
      let targetBranch = branch;
      if (!targetBranch) {
        try {
          targetBranch = resolveCurrentBranch(sourcePath);
        } catch (e) {
          targetBranch = 'main';
        }
      }

      // Check for conflicts
      if (!repoMap.has(resolvedPath)) {
        repoMap.set(resolvedPath, new Map());
      }

      const branches = repoMap.get(resolvedPath);
      if (branches.has(targetBranch)) {
        const conflictingIndex = branches.get(targetBranch);
        conflicts.push({
          repo: resolvedPath,
          branch: targetBranch,
          projects: [conflictingIndex, i]
        });
      } else {
        branches.set(targetBranch, i);
      }
    }

    return conflicts;
  }

  // Validate branch uniqueness for worktree mode
  const branchConflicts = validateWorktreeBranches(projects);
  if (branchConflicts.length > 0) {
    const conflict = branchConflicts[0];
    const projectNames = conflict.projects.map(i => projects[i].name || `项目${i + 1}`).join(', ');
    throw new Error(
      `无法创建工作区：分支 '${conflict.branch}' 在同一仓库中被多个项目使用 (${projectNames})。\n` +
      `仓库路径: ${conflict.repo}\n\n` +
      `Git worktree 不允许在同一仓库的多个工作树中检出相同的分支。\n\n` +
      `解决方案：\n` +
      `1. 为不同项目指定不同的分支名\n` +
      `2. 或者禁用其中一个项目的 worktree 模式（设置 createWorktree: false）`
    );
  }

  try {
    // 处理每个项目
    for (const proj of projects) {
      const { sourcePath, name: linkName, branch, baseBranch } = proj;
      // useWorktree: 未指定时，Git 仓库默认 true，非 Git 仓库默认 false
      const isGit = isGitRepo(sourcePath);
      const useWorktree = proj.createWorktree !== undefined ? proj.createWorktree : isGit;

      // 检查源项目是否存在
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`源项目不存在: ${sourcePath}`);
      }

      // 生成链接名（默认使用源目录名）
      const symlinkName = linkName || path.basename(sourcePath);
      const symlinkPath = path.join(workspacePath, symlinkName);

      let targetPath = sourcePath;
      let worktrees = [];

      // Git 仓库且需要创建 worktree：直接在工作区目录内创建，无需额外 symlink
      if (isGit && useWorktree) {
        // 获取当前分支作为默认分支
        let targetBranch = branch;
        if (!targetBranch) {
          try {
            targetBranch = resolveCurrentBranch(sourcePath);
          } catch (e) {
            targetBranch = 'main';
          }
        }

        // worktree 直接创建到工作区目录内的项目路径
        const worktreePath = symlinkPath;

        try {
          // 尝试检出已有分支
          runGitCommand(['worktree', 'add', worktreePath, targetBranch], {
            cwd: sourcePath
          });
        } catch (error) {
          // 如果分支不存在，尝试创建新分支
          try {
            const worktreeArgs = ['worktree', 'add', worktreePath, '-b', targetBranch];
            if (baseBranch && baseBranch.trim()) {
              worktreeArgs.push(baseBranch.trim());
            }
            runGitCommand(worktreeArgs, {
              cwd: sourcePath
            });
          } catch (err) {
            if (err.message.includes('already checked out')) {
              throw new Error(
                `无法创建 worktree：分支 '${targetBranch}' 已在其他工作树中检出。\n` +
                `错误详情: ${err.message}\n\n` +
                `提示：请为此项目指定不同的分支名，或禁用 worktree 模式。`
              );
            }
            throw new Error(`创建 worktree 失败: ${err.message}`);
          }
        }

        targetPath = worktreePath;
        worktrees.push({ branch: targetBranch, path: worktreePath });
      } else if (isGit) {
        // Git 仓库但不创建 worktree：symlink 指向源路径，记录已有 worktrees
        worktrees = getGitWorktrees(sourcePath);
        createSymlink(targetPath, symlinkPath);
      } else {
        // 非 Git 仓库：symlink 指向源路径
        createSymlink(targetPath, symlinkPath);
      }

      workspaceProjects.push({
        name: symlinkName,
        sourcePath,
        targetPath,
        isGitRepo: isGit,
        useWorktree: isGit && useWorktree,
        worktrees
      });
    }

    // 应用配置模板（如果指定）
    let templateInfo = null;
    if (configTemplateId) {
      try {
        const result = configTemplatesService.applyTemplate(workspacePath, configTemplateId);
        templateInfo = {
          templateId: configTemplateId,
          templateName: result.template,
          appliedAt: new Date().toISOString()
        };
      } catch (templateError) {
        console.warn('应用配置模板失败:', templateError.message);
        // 不中断工作区创建流程
      }
    }

    // 保存工作区配置
    const workspaceId = generateWorkspaceId();
    const workspace = {
      id: workspaceId,
      name,
      description,
      path: workspacePath,
      projects: workspaceProjects,
      configTemplate: templateInfo,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };

    const data = loadWorkspaces();
    data.workspaces.push(workspace);
    saveWorkspaces(data);

    return workspace;
  } catch (error) {
    // 清理已创建的目录
    try {
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error('清理失败:', cleanupError.message);
    }
    throw error;
  }
}

/**
 * 删除工作区
 * @param {string} id - 工作区 ID
 * @param {boolean} removeFiles - 是否删除物理文件
 */
function deleteWorkspace(id, removeFiles = false) {
  const data = loadWorkspaces();
  const index = data.workspaces.findIndex(ws => ws.id === id);

  if (index === -1) {
    throw new Error('工作区不存在');
  }

  const workspace = data.workspaces[index];

  // 注销 worktrees（worktree 目录在工作区内，git 引用需先注销）
  for (const proj of workspace.projects) {
    if (proj.useWorktree && proj.sourcePath && proj.targetPath) {
      if (fs.existsSync(proj.sourcePath)) {
        try {
          runGitCommand(['worktree', 'remove', proj.targetPath, '--force'], {
            cwd: proj.sourcePath
          });
        } catch (error) {
          console.error(`注销 worktree 失败: ${proj.targetPath}`, error.message);
        }
      }
    }
  }

  // 如果需要删除物理文件
  if (removeFiles && fs.existsSync(workspace.path)) {
    try {
      // 删除工作区目录
      fs.rmSync(workspace.path, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`删除工作区文件失败: ${error.message}`);
    }
  }

  // 从配置中移除
  data.workspaces.splice(index, 1);
  saveWorkspaces(data);

  return true;
}

/**
 * 更新工作区最后使用时间
 */
function updateWorkspaceLastUsed(id) {
  const data = loadWorkspaces();
  const workspace = data.workspaces.find(ws => ws.id === id);

  if (workspace) {
    workspace.lastUsed = new Date().toISOString();
    saveWorkspaces(data);
  }
}

/**
 * 为工作区添加项目
 */
function addProjectToWorkspace(workspaceId, projectConfig) {
  const data = loadWorkspaces();
  const workspace = data.workspaces.find(ws => ws.id === workspaceId);

  if (!workspace) {
    throw new Error('工作区不存在');
  }

  const { sourcePath, name: linkName, branch, baseBranch } = projectConfig;
  // useWorktree: 未指定时，Git 仓库默认 true，非 Git 仓库默认 false
  const isGit = isGitRepo(sourcePath);
  const useWorktree = projectConfig.createWorktree !== undefined ? projectConfig.createWorktree : isGit;

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`源项目不存在: ${sourcePath}`);
  }

  const symlinkName = linkName || path.basename(sourcePath);
  const symlinkPath = path.join(workspace.path, symlinkName);

  // 检查链接是否已存在
  if (fs.existsSync(symlinkPath)) {
    throw new Error(`项目已存在: ${symlinkName}`);
  }

  let targetPath = sourcePath;
  let worktrees = [];

  // Git 仓库且需要创建 worktree：直接在工作区目录内创建，无需额外 symlink
  if (isGit && useWorktree) {
    let targetBranch = branch;
    if (!targetBranch) {
      try {
        targetBranch = resolveCurrentBranch(sourcePath);
      } catch (e) {
        targetBranch = 'main';
      }
    }

    const worktreePath = symlinkPath;

    try {
      runGitCommand(['worktree', 'add', worktreePath, targetBranch], {
        cwd: sourcePath
      });
    } catch (error) {
      try {
        const worktreeArgs = ['worktree', 'add', worktreePath, '-b', targetBranch];
        if (baseBranch && baseBranch.trim()) {
          worktreeArgs.push(baseBranch.trim());
        }
        runGitCommand(worktreeArgs, { cwd: sourcePath });
      } catch (err) {
        if (err.message && err.message.includes('already checked out')) {
          throw new Error(
            `无法添加项目：分支 '${targetBranch}' 已在其他工作树中检出。\n` +
            `仓库路径: ${sourcePath}\n\n` +
            `解决方案：\n` +
            `1. 指定不同的分支名\n` +
            `2. 或者禁用 worktree 模式（设置 createWorktree: false）`
          );
        }
        throw new Error(`创建 worktree 失败: ${err.message}`);
      }
    }

    targetPath = worktreePath;
    worktrees.push({ branch: targetBranch, path: worktreePath });
  } else if (isGit) {
    // Git 仓库但不创建 worktree：symlink 指向源路径
    worktrees = getGitWorktrees(sourcePath);
    createSymlink(targetPath, symlinkPath);
  } else {
    // 非 Git 仓库：symlink 指向源路径
    createSymlink(targetPath, symlinkPath);
  }

  // 更新配置
  workspace.projects.push({
    name: symlinkName,
    sourcePath,
    targetPath,
    isGitRepo: isGit,
    useWorktree: isGit && useWorktree,
    worktrees
  });

  saveWorkspaces(data);
  return workspace;
}

/**
 * 从工作区移除项目
 */
function removeProjectFromWorkspace(workspaceId, projectName) {
  const data = loadWorkspaces();
  const workspace = data.workspaces.find(ws => ws.id === workspaceId);

  if (!workspace) {
    throw new Error('工作区不存在');
  }

  const projectIndex = workspace.projects.findIndex(p => p.name === projectName);

  if (projectIndex === -1) {
    throw new Error('项目不存在');
  }

  const project = workspace.projects[projectIndex];
  const projectPath = path.join(workspace.path, projectName);

  if (project.useWorktree) {
    // worktree 项目：用 git worktree remove 注销引用（目录在工作区内）
    if (fs.existsSync(projectPath) && fs.existsSync(project.sourcePath)) {
      try {
        runGitCommand(['worktree', 'remove', projectPath, '--force'], {
          cwd: project.sourcePath
        });
      } catch (error) {
        console.error(`注销 worktree 失败: ${projectPath}`, error.message);
        // git 注销失败时手动删除目录
        if (fs.existsSync(projectPath)) {
          fs.rmSync(projectPath, { recursive: true, force: true });
        }
      }
    }
  } else {
    // symlink 项目：直接删除软链接
    if (fs.existsSync(projectPath)) {
      fs.unlinkSync(projectPath);
    }
  }

  // 从配置中移除
  workspace.projects.splice(projectIndex, 1);
  saveWorkspaces(data);

  return workspace;
}


/**
 * 获取所有渠道（Claude/Codex/Gemini/OpenCode/OMP）的项目并集
 * @returns {Promise<Array>} 去重后的项目列表
 */
async function getAllAvailableProjects() {
  const { loadConfig } = require('../../config/loader');
  const sessionsService = require('./sessions');
  const codexSessionsService = require('./codex-sessions');
  const geminiSessionsService = require('./gemini-sessions');
  const opencodeSessionsService = require('./opencode-sessions');
  const ompSessionsService = require('./omp-sessions');
  const { isCodexInstalled } = require('./codex-config');
  const { isGeminiInstalled } = require('./gemini-config');
  const { isOpenCodeInstalled } = require('./opencode-sessions');

  const allProjects = [];
  const seenKeys = new Set();

  function addProject(channel, project) {
    if (!project || !project.name) return;

    const projectPath = project.fullPath || project.path || null;
    const keyBase = projectPath || project.name;
    const projectKey = `${channel}:${keyBase}`;
    if (seenKeys.has(projectKey)) return;
    seenKeys.add(projectKey);

    const displayName = project.displayName || (projectPath ? path.basename(projectPath) : project.name);
    const lastUsedValue = project.lastUsed || project.lastUpdated || project.mtimeMs || null;
    const lastUsed = typeof lastUsedValue === 'string'
      ? new Date(lastUsedValue).getTime()
      : (lastUsedValue || 0);

    allProjects.push({
      name: project.name,
      displayName,
      fullPath: projectPath || project.name,
      channel,
      sessionCount: project.sessionCount || 0,
      lastUsed,
      isGitRepo: projectPath ? isGitRepo(projectPath) : false
    });
  }

  try {
    const config = loadConfig();
    const claudeProjects = await sessionsService.getProjectsWithStats(config, { force: true });
    const list = Array.isArray(claudeProjects) ? claudeProjects : [];
    list.forEach(project => addProject('claude', project));
  } catch (error) {
    console.error('获取 claude 项目失败:', error.message);
  }

  try {
    if (isCodexInstalled()) {
      const codexProjects = codexSessionsService.getProjects();
      const list = Array.isArray(codexProjects) ? codexProjects : [];
      list.forEach(project => addProject('codex', project));
    }
  } catch (error) {
    console.error('获取 codex 项目失败:', error.message);
  }

  try {
    if (isGeminiInstalled()) {
      const geminiProjects = geminiSessionsService.getProjects();
      const list = Array.isArray(geminiProjects) ? geminiProjects : [];
      list.forEach(project => addProject('gemini', project));
    }
  } catch (error) {
    console.error('获取 gemini 项目失败:', error.message);
  }

  try {
    if (isOpenCodeInstalled()) {
      const opencodeProjects = opencodeSessionsService.getProjects();
      const list = Array.isArray(opencodeProjects) ? opencodeProjects : [];
      list.forEach(project => addProject('opencode', project));
    }
  } catch (error) {
    console.error('获取 opencode 项目失败:', error.message);
  }

  try {
    const ompProjects = ompSessionsService.getProjects();
    const list = Array.isArray(ompProjects) ? ompProjects : [];
    if (list.length > 0 || ompSessionsService.isOmpInstalled()) {
      list.forEach(project => addProject('omp', project));
    }
  } catch (error) {
    console.error('获取 OMP 项目失败:', error.message);
  }

  // 按最后使用时间排序
  allProjects.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

  return allProjects;
}

/**
 * 在工作区中启动 CLI 工具
 * @param {string} workspaceId 工作区 ID
 * @param {string} tool 工具名称 (claude/codex/gemini/opencode/omp/omp)
 * @param {string} projectName 可选，工作区内的项目名
 * @returns {object} 启动信息
 */
function getLaunchCommand(workspaceId, tool, projectName = null) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error('工作区不存在');
  }

  if (!workspace.exists) {
    throw new Error('工作区目录不存在');
  }

  // 确定工作目录
  let workDir = workspace.path;
  if (projectName) {
    const project = workspace.projects.find(p => p.name === projectName);
    if (!project) {
      throw new Error(`项目不存在: ${projectName}`);
    }
    workDir = path.join(workspace.path, projectName);
    if (!fs.existsSync(workDir)) {
      throw new Error(`项目目录不存在: ${workDir}`);
    }
  }

  const normalizedTool = tool === 'omp' ? 'omp' : tool;

  // 根据工具类型生成启动命令
  const commands = {
    claude: 'claude',
    codex: 'codex',
    gemini: 'gemini',
    opencode: 'opencode',
    omp: 'omp'
  };

  const cmd = commands[normalizedTool];
  if (!cmd) {
    throw new Error(`不支持的工具: ${tool}`);
  }

  return {
    command: cmd,
    cwd: workDir,
    workspaceName: workspace.name,
    projectName: projectName
  };
}

module.exports = {
  loadWorkspaces,
  saveWorkspaces,
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  deleteWorkspace,
  updateWorkspaceLastUsed,
  addProjectToWorkspace,
  removeProjectFromWorkspace,
  isGitRepo,
  getGitWorktrees,
  getAllAvailableProjects,
  getLaunchCommand
};
