// 工作区 API 路由
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const workspaceService = require('../services/workspace-service');

/**
 * GET /api/workspaces
 * 获取所有工作区列表
 */
router.get('/', (req, res) => {
  try {
    const workspaces = workspaceService.listWorkspaces();
    res.json({
      success: true,
      data: workspaces
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/workspaces/read-file
 * 读取工作区中的文件内容（仅限 CLAUDE.md 等配置文件）
 * Query: path=文件路径
 */
router.get('/read-file', (req, res) => {
  try {
    const filePath = req.query.path;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '文件路径不能为空'
      });
    }

    // 安全检查：只允许读取特定类型的文件
    const allowedFiles = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.ctx-config.json'];
    const fileName = path.basename(filePath);

    if (!allowedFiles.includes(fileName)) {
      return res.status(403).json({
        success: false,
        message: '不允许读取该文件'
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    const content = fs.readFileSync(filePath, 'utf8');

    res.json({
      success: true,
      content: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/workspaces/check-git/:projectPath
 * 检查项目是否是 git 仓库并获取 worktrees
 */
router.get('/check-git/*', (req, res) => {
  try {
    const projectPath = req.params[0];

    if (!projectPath) {
      return res.status(400).json({
        success: false,
        message: '项目路径不能为空'
      });
    }

    const isGit = workspaceService.isGitRepo(projectPath);
    const worktrees = isGit ? workspaceService.getGitWorktrees(projectPath) : [];

    res.json({
      success: true,
      data: {
        isGitRepo: isGit,
        worktrees
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/workspaces/available-projects
 * 获取所有渠道（Claude/Codex/Gemini）的项目并集
 */
router.get('/available-projects', async (req, res) => {
  try {
    const projects = await workspaceService.getAllAvailableProjects();
    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/workspaces/:id
 * 获取单个工作区详情
 */
// 注意：此路由需要放在所有静态子路由之后，避免把 /available-projects 等路径当成 id
router.get('/:id', (req, res, next) => {
  try {
    // 兜底：即便路由顺序被改动，也避免把保留路径当成工作区 ID
    const reservedIds = new Set(['available-projects', 'read-file']);
    if (reservedIds.has(req.params.id)) {
      return next();
    }

    const workspace = workspaceService.getWorkspace(req.params.id);
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: '工作区不存在'
      });
    }
    res.json({
      success: true,
      data: workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/workspaces
 * 创建新工作区
 * Body: {
 *   name: string,
 *   description?: string,
 *   baseDir?: string,
 *   projects: [{
 *     sourcePath: string,
 *     name?: string,
 *     createWorktree?: boolean,
 *     branch?: string
 *   }]
 * }
 */
router.post('/', (req, res) => {
  try {
    const { name, description, baseDir, projects, configTemplateId, permissionTemplate } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: '工作区名称不能为空'
      });
    }

    if (!projects || !Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({
        success: false,
        message: '至少需要选择一个项目'
      });
    }

    // 验证项目配置
    for (const proj of projects) {
      if (!proj.sourcePath || !proj.sourcePath.trim()) {
        return res.status(400).json({
          success: false,
          message: '项目源路径不能为空'
        });
      }

      if (proj.createWorktree && (!proj.branch || !proj.branch.trim())) {
        return res.status(400).json({
          success: false,
          message: '创建 worktree 时必须指定分支名'
        });
      }
    }

    const workspace = workspaceService.createWorkspace({
      name,
      description,
      baseDir,
      projects,
      configTemplateId,
      permissionTemplate
    });

    res.json({
      success: true,
      message: '工作区创建成功',
      data: workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /api/workspaces/:id
 * 删除工作区
 * Query: removeFiles=true/false
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const removeFiles = req.query.removeFiles === 'true';

    workspaceService.deleteWorkspace(id, removeFiles);

    res.json({
      success: true,
      message: '工作区删除成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/workspaces/:id/last-used
 * 更新工作区最后使用时间
 */
router.put('/:id/last-used', (req, res) => {
  try {
    workspaceService.updateWorkspaceLastUsed(req.params.id);
    res.json({
      success: true,
      message: '更新成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/workspaces/:id/projects
 * 向工作区添加项目
 * Body: {
 *   sourcePath: string,
 *   name?: string,
 *   createWorktree?: boolean,
 *   branch?: string,
 *   baseBranch?: string
 * }
 */
router.post('/:id/projects', (req, res) => {
  try {
    const { id } = req.params;
    const { sourcePath, name, createWorktree, branch, baseBranch } = req.body;

    if (!sourcePath || !sourcePath.trim()) {
      return res.status(400).json({
        success: false,
        message: '项目源路径不能为空'
      });
    }

    if (createWorktree && (!branch || !branch.trim())) {
      return res.status(400).json({
        success: false,
        message: '创建 worktree 时必须指定分支名'
      });
    }

    const workspace = workspaceService.addProjectToWorkspace(id, {
      sourcePath,
      name,
      createWorktree,
      branch,
      baseBranch
    });

    res.json({
      success: true,
      message: '项目添加成功',
      data: workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /api/workspaces/:id/projects/:projectName
 * 从工作区移除项目
 * Query: removeWorktrees=true/false
 */
router.delete('/:id/projects/:projectName', (req, res) => {
  try {
    const { id, projectName } = req.params;
    const removeWorktrees = req.query.removeWorktrees === 'true';

    const workspace = workspaceService.removeProjectFromWorkspace(
      id,
      projectName,
      removeWorktrees
    );

    res.json({
      success: true,
      message: '项目移除成功',
      data: workspace
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/workspaces/:id/launch
 * 获取在工作区启动 CLI 工具的命令
 * Body: { tool: 'claude' | 'codex' | 'gemini', projectName?: string }
 */
router.post('/:id/launch', (req, res) => {
  try {
    const { id } = req.params;
    const { tool, projectName } = req.body;

    if (!tool) {
      return res.status(400).json({
        success: false,
        message: '请指定要启动的工具'
      });
    }

    const launchInfo = workspaceService.getLaunchCommand(id, tool, projectName);
    res.json({
      success: true,
      data: launchInfo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
