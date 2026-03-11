/**
 * Agents API 路由
 *
 * 管理 Claude Code 自定义代理
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { AgentsService } = require('../services/agents-service');
const { PATHS, HOME_DIR } = require('../../config/paths');

const router = express.Router();
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'opencode'];
const agentServices = new Map();
const DEFAULT_PROJECT_ALLOWED_ROOTS = [HOME_DIR, process.cwd()];

function isSupportedPlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(platform);
}

function getRawPlatform(req) {
  const queryPlatform = typeof req.query?.platform === 'string' ? req.query.platform.trim() : '';
  const bodyPlatform = typeof req.body?.platform === 'string' ? req.body.platform.trim() : '';
  return queryPlatform || bodyPlatform || '';
}

function resolvePlatform(rawPlatform) {
  return rawPlatform || 'claude';
}

function getPlatform(req) {
  return resolvePlatform(getRawPlatform(req));
}

function getAgentsService(req) {
  const platform = getPlatform(req);
  if (!agentServices.has(platform)) {
    agentServices.set(platform, new AgentsService(platform));
  }
  return { platform, service: agentServices.get(platform) };
}

function validateScopeForPlatform(scope, platform, projectPath) {
  if (!['user', 'project'].includes(scope)) {
    return '无效的 scope，必须是 user 或 project';
  }

  if (platform === 'codex' && scope !== 'user') {
    return 'Codex 平台仅支持 user 作用域代理';
  }

  if (scope === 'project' && !projectPath) {
    return '项目级代理需要提供 projectPath';
  }

  return null;
}

function validateAgentFileName(fileName) {
  if (typeof fileName !== 'string') {
    return '代理文件名必须是字符串';
  }

  const normalized = fileName.trim();
  if (!normalized) {
    return '代理文件名不能为空';
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized) || normalized.includes('..')) {
    return '代理文件名只能包含字母、数字、点号、横杠和下划线，且不能包含连续点';
  }
  return null;
}

function isCodexRepoOperationUnsupported(platform) {
  return platform === 'codex';
}

function validateRepoPath(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath.trim()) {
    return '代理仓库路径不能为空';
  }

  const raw = repoPath.replace(/\\/g, '/').trim();
  const normalized = path.posix.normalize(raw).replace(/^(\.\/)+/, '');
  if (!normalized ||
      normalized === '.' ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.includes('/../') ||
      path.posix.isAbsolute(normalized)) {
    return '代理仓库路径不合法';
  }

  if (!normalized.endsWith('.md')) {
    return '代理仓库路径必须是 .md 文件';
  }

  return null;
}

function getAllowedProjectRoots() {
  const roots = new Set(DEFAULT_PROJECT_ALLOWED_ROOTS.map(item => path.resolve(item)));

  // 从工作区配置中扩展允许目录，避免误拦截外部磁盘/自定义根目录项目
  try {
    const workspaceConfigPath = path.join(PATHS.base, 'workspaces.json');
    if (fs.existsSync(workspaceConfigPath)) {
      const raw = fs.readFileSync(workspaceConfigPath, 'utf-8');
      const parsed = JSON.parse(raw || '{}');
      const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];

      for (const workspace of workspaces) {
        if (workspace && typeof workspace.path === 'string' && workspace.path.trim()) {
          roots.add(path.resolve(workspace.path.trim()));
        }
        const projects = Array.isArray(workspace?.projects) ? workspace.projects : [];
        for (const project of projects) {
          if (project && typeof project.sourcePath === 'string' && project.sourcePath.trim()) {
            roots.add(path.resolve(project.sourcePath.trim()));
          }
        }
      }
    }
  } catch (err) {
    // 忽略工作区配置读取失败，使用默认白名单继续
  }

  const raw = typeof process.env.CC_TOOL_PROJECT_PATH_ALLOWLIST === 'string'
    ? process.env.CC_TOOL_PROJECT_PATH_ALLOWLIST
    : '';
  const configuredRoots = raw
    .split(path.delimiter)
    .map(item => item.trim())
    .filter(Boolean);

  if (configuredRoots.length > 0) {
    for (const configuredRoot of configuredRoots) {
      roots.add(path.resolve(configuredRoot));
    }
  }

  return Array.from(roots);
}

function isPathInside(basePath, targetPath) {
  return targetPath === basePath || targetPath.startsWith(`${basePath}${path.sep}`);
}

function validateProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    return { error: 'projectPath 必须是非空字符串' };
  }

  if (projectPath.includes('\0')) {
    return { error: 'projectPath 不合法' };
  }

  const trimmed = projectPath.trim();
  if (!path.isAbsolute(trimmed)) {
    return { error: 'projectPath 必须是绝对路径' };
  }

  const resolvedPath = path.resolve(trimmed);
  if (!fs.existsSync(resolvedPath)) {
    return { error: 'projectPath 不存在' };
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isDirectory()) {
    return { error: 'projectPath 必须是目录' };
  }

  const realProjectPath = fs.realpathSync(resolvedPath);
  const allowedRoots = getAllowedProjectRoots();
  const isAllowed = allowedRoots.some((rootPath) => {
    try {
      const resolvedRoot = path.resolve(rootPath);
      if (!fs.existsSync(resolvedRoot)) {
        return false;
      }
      const realRootPath = fs.realpathSync(resolvedRoot);
      return isPathInside(realRootPath, realProjectPath);
    } catch (err) {
      return false;
    }
  });

  if (!isAllowed) {
    return { error: 'projectPath 不在允许的项目目录范围内' };
  }

  return { projectPath: realProjectPath };
}

function normalizeProjectPathForScope(scope, projectPath) {
  if (scope !== 'project') {
    return { projectPath: null };
  }

  return validateProjectPath(projectPath);
}

function normalizeOptionalProjectPath(projectPath) {
  if (projectPath == null || projectPath === '') {
    return { projectPath: null };
  }
  return validateProjectPath(projectPath);
}

router.use((req, res, next) => {
  const rawPlatform = getRawPlatform(req);
  if (rawPlatform && !isSupportedPlatform(rawPlatform)) {
    return res.status(400).json({
      success: false,
      message: `不支持的平台: ${rawPlatform}`
    });
  }
  next();
});

/**
 * 获取代理列表
 * GET /api/agents
 * Query: projectPath - 项目路径（可选，用于获取项目级代理）
 */
router.get('/', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    const { projectPath } = req.query;
    const normalizedProjectPath = normalizeOptionalProjectPath(projectPath);
    if (normalizedProjectPath.error) {
      return res.status(400).json({
        success: false,
        message: normalizedProjectPath.error
      });
    }
    const result = service.listAgents(normalizedProjectPath.projectPath);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Agents API] List agents error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取代理统计
 * GET /api/agents/stats
 */
router.get('/stats', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    const { projectPath } = req.query;
    const normalizedProjectPath = normalizeOptionalProjectPath(projectPath);
    if (normalizedProjectPath.error) {
      return res.status(400).json({
        success: false,
        message: normalizedProjectPath.error
      });
    }
    const stats = service.getStats(normalizedProjectPath.projectPath);

    res.json({
      success: true,
      platform,
      ...stats
    });
  } catch (err) {
    console.error('[Agents API] Get stats error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取单个代理详情
 * GET /api/agents/:scope/:fileName
 */
router.get('/:scope/:fileName', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    const { scope, fileName } = req.params;
    const { projectPath } = req.query;

    const scopeError = validateScopeForPlatform(scope, platform, projectPath);
    if (scopeError) {
      return res.status(400).json({
        success: false,
        message: scopeError
      });
    }

    const fileNameError = validateAgentFileName(fileName);
    if (fileNameError) {
      return res.status(400).json({
        success: false,
        message: fileNameError
      });
    }

    const normalizedProjectPath = normalizeProjectPathForScope(scope, projectPath);
    if (normalizedProjectPath.error) {
      return res.status(400).json({
        success: false,
        message: normalizedProjectPath.error
      });
    }

    const agent = service.getAgent(fileName, scope, normalizedProjectPath.projectPath);

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: `代理 "${fileName}" 不存在`
      });
    }

    res.json({
      success: true,
      platform,
      agent
    });
  } catch (err) {
    console.error('[Agents API] Get agent error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 创建代理
 * POST /api/agents
 * Body: { fileName, scope, projectPath?, name, description, tools?, model?, permissionMode?, skills?, systemPrompt? }
 */
router.post('/', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    const {
      fileName,
      scope,
      projectPath,
      name,
      description,
      tools,
      model,
      permissionMode,
      skills,
      systemPrompt,
      configMode,
      configFile,
      configContent
    } = req.body;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        message: '代理文件名不能为空'
      });
    }

    const fileNameError = validateAgentFileName(fileName);
    if (fileNameError) {
      return res.status(400).json({
        success: false,
        message: fileNameError
      });
    }

    const scopeError = validateScopeForPlatform(scope, platform, projectPath);
    if (scopeError) {
      return res.status(400).json({
        success: false,
        message: scopeError
      });
    }

    const normalizedProjectPath = normalizeProjectPathForScope(scope, projectPath);
    if (normalizedProjectPath.error) {
      return res.status(400).json({
        success: false,
        message: normalizedProjectPath.error
      });
    }

    const agent = service.createAgent({
      fileName,
      scope,
      projectPath: normalizedProjectPath.projectPath,
      name: name || fileName,
      description: description || '',
      tools: tools || '',
      model: model || '',
      permissionMode: permissionMode || '',
      skills: skills || '',
      systemPrompt: systemPrompt || '',
      configMode,
      configFile,
      configContent
    });

    res.json({
      success: true,
      platform,
      agent,
      message: '代理创建成功'
    });
  } catch (err) {
    console.error('[Agents API] Create agent error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 更新代理
 * PUT /api/agents/:scope/:fileName
 */
router.put('/:scope/:fileName', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    const { scope, fileName } = req.params;
    const {
      projectPath,
      name,
      description,
      tools,
      model,
      permissionMode,
      skills,
      systemPrompt,
      configMode,
      configFile,
      configContent
    } = req.body;

    const scopeError = validateScopeForPlatform(scope, platform, projectPath);
    if (scopeError) {
      return res.status(400).json({
        success: false,
        message: scopeError
      });
    }

    const fileNameError = validateAgentFileName(fileName);
    if (fileNameError) {
      return res.status(400).json({
        success: false,
        message: fileNameError
      });
    }

    const normalizedProjectPath = normalizeProjectPathForScope(scope, projectPath);
    if (normalizedProjectPath.error) {
      return res.status(400).json({
        success: false,
        message: normalizedProjectPath.error
      });
    }

    const agent = service.updateAgent({
      fileName,
      scope,
      projectPath: normalizedProjectPath.projectPath,
      name: name || fileName,
      description: description || '',
      tools: tools || '',
      model: model || '',
      permissionMode: permissionMode || '',
      skills: skills || '',
      systemPrompt: systemPrompt || '',
      configMode,
      configFile,
      configContent
    });

    res.json({
      success: true,
      platform,
      agent,
      message: '代理更新成功'
    });
  } catch (err) {
    console.error('[Agents API] Update agent error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 删除代理
 * DELETE /api/agents/:scope/:fileName
 */
router.delete('/:scope/:fileName', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    const { scope, fileName } = req.params;
    const { projectPath } = req.query;

    const scopeError = validateScopeForPlatform(scope, platform, projectPath);
    if (scopeError) {
      return res.status(400).json({
        success: false,
        message: scopeError
      });
    }

    const normalizedProjectPath = normalizeProjectPathForScope(scope, projectPath);
    if (normalizedProjectPath.error) {
      return res.status(400).json({
        success: false,
        message: normalizedProjectPath.error
      });
    }

    const fileNameError = validateAgentFileName(fileName);
    if (fileNameError) {
      return res.status(400).json({
        success: false,
        message: fileNameError
      });
    }

    const result = service.deleteAgent(fileName, scope, normalizedProjectPath.projectPath);

    res.json({
      platform,
      success: result.success,
      message: result.message
    });
  } catch (err) {
    console.error('[Agents API] Delete agent error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// ==================== 仓库管理 API ====================

/**
 * 获取所有代理（包括远程仓库）
 * GET /api/agents/all
 * Query: projectPath, refresh=1 强制刷新缓存
 */
router.get('/all', async (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    const { projectPath, refresh } = req.query;
    const normalizedProjectPath = normalizeOptionalProjectPath(projectPath);
    if (normalizedProjectPath.error) {
      return res.status(400).json({
        success: false,
        message: normalizedProjectPath.error
      });
    }
    const forceRefresh = refresh === '1';
    const result = await service.listAllAgents(normalizedProjectPath.projectPath, forceRefresh);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Agents API] List all agents error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取仓库列表
 * GET /api/agents/repos
 */
router.get('/repos', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    if (isCodexRepoOperationUnsupported(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Codex 平台暂不支持远程仓库代理'
      });
    }
    const repos = service.getRepos();
    res.json({
      success: true,
      platform,
      repos
    });
  } catch (err) {
    console.error('[Agents API] Get repos error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 添加仓库
 * POST /api/agents/repos
 * Body: { owner, name, branch, directory, enabled }
 */
router.post('/repos', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    if (isCodexRepoOperationUnsupported(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Codex 平台暂不支持远程仓库代理'
      });
    }
    const { owner, name, branch = 'main', directory = '', enabled = true } = req.body;

    if (!owner || !name) {
      return res.status(400).json({
        success: false,
        message: 'Missing owner or name'
      });
    }

    const repos = service.addRepo({ owner, name, branch, directory, enabled });

    res.json({
      success: true,
      platform,
      repos
    });
  } catch (err) {
    console.error('[Agents API] Add repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 删除仓库
 * DELETE /api/agents/repos/:owner/:name
 * Query: directory - 可选，子目录路径
 */
router.delete('/repos/:owner/:name', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    if (isCodexRepoOperationUnsupported(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Codex 平台暂不支持远程仓库代理'
      });
    }
    const { owner, name } = req.params;
    const { directory = '' } = req.query;
    const repos = service.removeRepo(owner, name, directory);

    res.json({
      success: true,
      platform,
      repos
    });
  } catch (err) {
    console.error('[Agents API] Remove repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 切换仓库启用状态
 * PUT /api/agents/repos/:owner/:name/toggle
 * Body: { enabled, directory }
 */
router.put('/repos/:owner/:name/toggle', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    if (isCodexRepoOperationUnsupported(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Codex 平台暂不支持远程仓库代理'
      });
    }
    const { owner, name } = req.params;
    const { enabled, directory = '' } = req.body;

    const repos = service.toggleRepo(owner, name, directory, enabled);

    res.json({
      success: true,
      platform,
      repos
    });
  } catch (err) {
    console.error('[Agents API] Toggle repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 从远程仓库安装代理
 * POST /api/agents/install
 * Body: agent object from listAllAgents
 */
router.post('/install', async (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    if (isCodexRepoOperationUnsupported(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Codex 平台暂不支持远程仓库代理安装'
      });
    }
    const agent = req.body;

    if (!agent || !agent.repoOwner || !agent.repoName) {
      return res.status(400).json({
        success: false,
        message: 'Missing agent info or repo info'
      });
    }

    const fileNameError = validateAgentFileName(agent.fileName);
    if (fileNameError) {
      return res.status(400).json({
        success: false,
        message: fileNameError
      });
    }

    const repoPathError = validateRepoPath(agent.repoPath);
    if (repoPathError) {
      return res.status(400).json({
        success: false,
        message: repoPathError
      });
    }

    const result = await service.installFromRemote(agent);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Agents API] Install agent error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 卸载代理
 * POST /api/agents/uninstall
 * Body: { fileName } - 代理的文件名（不含扩展名）
 */
router.post('/uninstall', (req, res) => {
  try {
    const { platform, service } = getAgentsService(req);
    if (isCodexRepoOperationUnsupported(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Codex 平台暂不支持远程仓库代理卸载'
      });
    }
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        message: 'Missing fileName'
      });
    }

    const fileNameError = validateAgentFileName(fileName);
    if (fileNameError) {
      return res.status(400).json({
        success: false,
        message: fileNameError
      });
    }

    const result = service.uninstallAgent(fileName);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Agents API] Uninstall agent error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
