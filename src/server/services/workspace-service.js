// 多项目工作区服务
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PATHS } = require('../../config/paths');
const configTemplatesService = require('./config-templates-service');
const permissionTemplatesService = require('./permission-templates-service');

// 工作区配置文件路径
const WORKSPACES_CONFIG = path.join(PATHS.base, 'workspaces.json');

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
    const output = execSync('git worktree list --porcelain', {
      cwd: repoPath,
      encoding: 'utf8'
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
  const { name, description = '', baseDir, projects = [], configTemplateId, permissionTemplate } = options;

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

  try {
    // 处理每个项目
    for (const proj of projects) {
      const { sourcePath, name: linkName, branch } = proj;
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

      // Git 仓库且需要创建 worktree
      if (isGit && useWorktree) {
        // 获取当前分支作为默认分支
        let targetBranch = branch;
        if (!targetBranch) {
          try {
            targetBranch = execSync('git rev-parse --abbrev-ref HEAD', {
              cwd: sourcePath,
              encoding: 'utf8'
            }).trim();
          } catch (e) {
            targetBranch = 'main';
          }
        }

        // worktree 路径：源目录同级，名称为 "项目名-workspace-分支名"
        const worktreePath = path.join(
          path.dirname(sourcePath),
          `${path.basename(sourcePath)}-ws-${targetBranch.replace(/\//g, '-')}`
        );

        // 检查 worktree 是否已存在
        if (fs.existsSync(worktreePath)) {
          // 已存在则直接使用
          targetPath = worktreePath;
          worktrees.push({
            branch: targetBranch,
            path: worktreePath
          });
        } else {
          try {
            // 尝试检出已有分支
            execSync(`git worktree add "${worktreePath}" "${targetBranch}"`, {
              cwd: sourcePath,
              stdio: 'pipe'
            });

            targetPath = worktreePath;
            worktrees.push({
              branch: targetBranch,
              path: worktreePath
            });
          } catch (error) {
            // 如果分支不存在，尝试创建新分支
            try {
              execSync(`git worktree add "${worktreePath}" -b "${targetBranch}"`, {
                cwd: sourcePath,
                stdio: 'pipe'
              });
              targetPath = worktreePath;
              worktrees.push({
                branch: targetBranch,
                path: worktreePath
              });
            } catch (err) {
              // worktree 创建失败，回退到软链接模式
              console.warn(`创建 worktree 失败，使用软链接: ${err.message}`);
              targetPath = sourcePath;
              worktrees = getGitWorktrees(sourcePath);
            }
          }
        }
      } else if (isGit) {
        // Git 仓库但不创建 worktree，获取已有的 worktrees 信息
        worktrees = getGitWorktrees(sourcePath);
      }
      // 非 Git 仓库：targetPath 保持为 sourcePath，直接软链接

      // 创建软链接
      fs.symlinkSync(targetPath, symlinkPath, 'dir');

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

    // 应用权限模板（如果指定）
    let permissionInfo = null;
    if (permissionTemplate) {
      try {
        // 从权限模板服务获取模板
        const template = permissionTemplatesService.getTemplateById(permissionTemplate);

        if (template && template.permissions) {
          // 为工作区中的每个项目应用权限设置
          for (const proj of workspaceProjects) {
            const projSettingsDir = path.join(proj.targetPath, '.claude');
            const projSettingsFile = path.join(projSettingsDir, 'settings.json');

            // 确保 .claude 目录存在
            if (!fs.existsSync(projSettingsDir)) {
              fs.mkdirSync(projSettingsDir, { recursive: true });
            }

            // 读取现有设置或创建新的
            let settings = {};
            if (fs.existsSync(projSettingsFile)) {
              try {
                settings = JSON.parse(fs.readFileSync(projSettingsFile, 'utf8'));
              } catch (e) {
                settings = {};
              }
            }

            // 更新权限设置
            settings.permissions = {
              allow: template.permissions.allow || [],
              deny: template.permissions.deny || []
            };

            // 保存设置
            fs.writeFileSync(projSettingsFile, JSON.stringify(settings, null, 2), 'utf8');
          }

          permissionInfo = {
            template: permissionTemplate,
            appliedAt: new Date().toISOString()
          };
        }
      } catch (permError) {
        console.warn('应用权限模板失败:', permError.message);
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
      permissionTemplate: permissionInfo,
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

  // 清理 worktrees (无论是否删除工作区目录,都应该清理 worktree)
  for (const proj of workspace.projects) {
    if (proj.isGitRepo && proj.sourcePath && fs.existsSync(proj.sourcePath)) {
      try {
        // 重新扫描实际的 worktrees,确保获取最新状态
        const actualWorktrees = getGitWorktrees(proj.sourcePath);
        for (const wt of actualWorktrees) {
          // 只删除属于这个工作区的 worktree (通过 -ws- 标识符识别)
          if (wt.path && wt.path.includes('-ws-')) {
            try {
              console.log(`清理 worktree: ${wt.path}`);
              execSync(`git worktree remove "${wt.path}" --force`, {
                cwd: proj.sourcePath,
                stdio: 'pipe'
              });
            } catch (error) {
              console.error(`删除 worktree 失败: ${wt.path}`, error.message);
              // 如果 git worktree remove 失败,尝试手动删除目录
              if (fs.existsSync(wt.path)) {
                try {
                  fs.rmSync(wt.path, { recursive: true, force: true });
                  console.log(`手动删除 worktree 目录: ${wt.path}`);
                } catch (rmError) {
                  console.error(`手动删除 worktree 目录失败: ${wt.path}`, rmError.message);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`扫描 worktree 失败: ${proj.sourcePath}`, error.message);
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

  const { sourcePath, name: linkName, branch } = projectConfig;
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

  // Git 仓库且需要创建 worktree
  if (isGit && useWorktree) {
    // 获取当前分支作为默认分支
    let targetBranch = branch;
    if (!targetBranch) {
      try {
        targetBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: sourcePath,
          encoding: 'utf8'
        }).trim();
      } catch (e) {
        targetBranch = 'main';
      }
    }

    const worktreePath = path.join(
      path.dirname(sourcePath),
      `${path.basename(sourcePath)}-ws-${targetBranch.replace(/\//g, '-')}`
    );

    // 检查 worktree 是否已存在
    if (fs.existsSync(worktreePath)) {
      targetPath = worktreePath;
      worktrees.push({ branch: targetBranch, path: worktreePath });
    } else {
      try {
        execSync(`git worktree add "${worktreePath}" "${targetBranch}"`, {
          cwd: sourcePath,
          stdio: 'pipe'
        });
        targetPath = worktreePath;
        worktrees.push({ branch: targetBranch, path: worktreePath });
      } catch (error) {
        try {
          execSync(`git worktree add "${worktreePath}" -b "${targetBranch}"`, {
            cwd: sourcePath,
            stdio: 'pipe'
          });
          targetPath = worktreePath;
          worktrees.push({ branch: targetBranch, path: worktreePath });
        } catch (err) {
          console.warn(`创建 worktree 失败，使用软链接: ${err.message}`);
          targetPath = sourcePath;
          worktrees = getGitWorktrees(sourcePath);
        }
      }
    }
  } else if (isGit) {
    worktrees = getGitWorktrees(sourcePath);
  }

  // 创建软链接
  fs.symlinkSync(targetPath, symlinkPath, 'dir');

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
function removeProjectFromWorkspace(workspaceId, projectName, removeWorktrees = false) {
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
  const symlinkPath = path.join(workspace.path, projectName);

  // 删除软链接
  if (fs.existsSync(symlinkPath)) {
    fs.unlinkSync(symlinkPath);
  }

  // 清理 worktrees
  if (removeWorktrees && project.worktrees && project.worktrees.length > 0) {
    for (const wt of project.worktrees) {
      if (fs.existsSync(wt.path)) {
        try {
          execSync(`git worktree remove "${wt.path}" --force`, {
            cwd: project.sourcePath,
            stdio: 'pipe'
          });
        } catch (error) {
          console.error(`删除 worktree 失败: ${wt.path}`, error.message);
        }
      }
    }
  }

  // 从配置中移除
  workspace.projects.splice(projectIndex, 1);
  saveWorkspaces(data);

  return workspace;
}


/**
 * 获取所有渠道（Claude/Codex/Gemini）的项目并集
 * @returns {Promise<Array>} 去重后的项目列表
 */
async function getAllAvailableProjects() {
  const { loadConfig } = require('../../config/loader');
  const sessionsService = require('./sessions');
  const codexSessionsService = require('./codex-sessions');
  const geminiSessionsService = require('./gemini-sessions');
  const { isCodexInstalled } = require('./codex-config');
  const { isGeminiInstalled } = require('./gemini-config');

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
    const lastUsedValue = project.lastUsed || project.lastUpdated || null;
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

  // 按最后使用时间排序
  allProjects.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

  return allProjects;
}

/**
 * 在工作区中启动 CLI 工具
 * @param {string} workspaceId 工作区 ID
 * @param {string} tool 工具名称 (claude/codex/gemini)
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

  // 根据工具类型生成启动命令
  const commands = {
    claude: 'claude',
    codex: 'codex',
    gemini: 'gemini'
  };

  const cmd = commands[tool];
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
