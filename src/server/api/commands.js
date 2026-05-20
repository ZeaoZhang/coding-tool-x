/**
 * Commands API 路由
 *
 * 管理 Claude/Codex/Gemini/OpenCode 自定义命令
 */

const express = require('express');
const { CommandsService } = require('../services/commands-service');
const { sendApiError } = require('./validation-errors');

const router = express.Router();
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'pi'];
const commandServices = new Map();

function resolvePlatform(rawPlatform) {
  return SUPPORTED_PLATFORMS.includes(rawPlatform) ? rawPlatform : 'claude';
}

function getPlatform(req) {
  return resolvePlatform(req.query?.platform || req.body?.platform);
}

function getCommandsService(req) {
  const platform = getPlatform(req);
  if (!commandServices.has(platform)) {
    commandServices.set(platform, new CommandsService(platform));
  }
  return { platform, service: commandServices.get(platform) };
}

/**
 * 获取命令列表
 * GET /api/commands
 * Query: projectPath - 项目路径（可选，用于获取项目级命令）
 */
router.get('/', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { projectPath } = req.query;
    const result = service.listCommands(projectPath || null);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Commands API] List commands error:', err);
    sendApiError(res, err);
  }
});

/**
 * 获取命令统计
 * GET /api/commands/stats
 */
router.get('/stats', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { projectPath } = req.query;
    const stats = service.getStats(projectPath || null);

    res.json({
      success: true,
      platform,
      ...stats
    });
  } catch (err) {
    console.error('[Commands API] Get stats error:', err);
    sendApiError(res, err);
  }
});

/**
 * 获取单个命令详情
 * GET /api/commands/:scope/:name
 * GET /api/commands/:scope/ns/:namespace/:name
 */
router.get('/:scope/:name', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { scope, name } = req.params;
    const { projectPath, namespace } = req.query;

    if (!['user', 'project'].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: '无效的 scope，必须是 user 或 project'
      });
    }

    if (scope === 'project' && !projectPath) {
      return res.status(400).json({
        success: false,
        message: '获取项目级命令需要提供 projectPath'
      });
    }

    const command = service.getCommand(name, scope, projectPath || null, namespace || null);

    if (!command) {
      return res.status(404).json({
        success: false,
        message: `命令 "${name}" 不存在`
      });
    }

    res.json({
      success: true,
      platform,
      command
    });
  } catch (err) {
    console.error('[Commands API] Get command error:', err);
    sendApiError(res, err);
  }
});

/**
 * 创建命令
 * POST /api/commands
 * Body: { name, scope, projectPath?, namespace?, description?, allowedTools?, argumentHint?, body }
 */
router.post('/', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { name, scope, projectPath, namespace, description, allowedTools, argumentHint, agent, model, subtask, body } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: '命令名称不能为空'
      });
    }

    if (!['user', 'project'].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: '无效的 scope，必须是 user 或 project'
      });
    }

    if (scope === 'project' && !projectPath) {
      return res.status(400).json({
        success: false,
        message: '创建项目级命令需要提供 projectPath'
      });
    }

    const command = service.createCommand({
      name,
      scope,
      projectPath: projectPath || null,
      namespace: namespace || null,
      description: description || '',
      allowedTools: allowedTools || '',
      argumentHint: argumentHint || '',
      agent: agent || '',
      model: model || '',
      subtask: typeof subtask === 'boolean' ? subtask : undefined,
      body: body || ''
    });

    res.json({
      success: true,
      platform,
      command,
      message: '命令创建成功'
    });
  } catch (err) {
    console.error('[Commands API] Create command error:', err);
    sendApiError(res, err);
  }
});

/**
 * 更新命令
 * PUT /api/commands/:scope/:name
 */
router.put('/:scope/:name', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { scope, name } = req.params;
    const { projectPath, namespace, description, allowedTools, argumentHint, agent, model, subtask, body } = req.body;

    if (!['user', 'project'].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: '无效的 scope，必须是 user 或 project'
      });
    }

    if (scope === 'project' && !projectPath) {
      return res.status(400).json({
        success: false,
        message: '更新项目级命令需要提供 projectPath'
      });
    }

    const command = service.updateCommand({
      name,
      scope,
      projectPath: projectPath || null,
      namespace: namespace || null,
      description: description || '',
      allowedTools: allowedTools || '',
      argumentHint: argumentHint || '',
      agent: agent || '',
      model: model || '',
      subtask: typeof subtask === 'boolean' ? subtask : undefined,
      body: body || ''
    });

    res.json({
      success: true,
      platform,
      command,
      message: '命令更新成功'
    });
  } catch (err) {
    console.error('[Commands API] Update command error:', err);
    sendApiError(res, err);
  }
});

/**
 * 删除命令
 * DELETE /api/commands/:scope/:name
 */
router.delete('/:scope/:name', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { scope, name } = req.params;
    const { projectPath, namespace } = req.query;

    if (!['user', 'project'].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: '无效的 scope，必须是 user 或 project'
      });
    }

    if (scope === 'project' && !projectPath) {
      return res.status(400).json({
        success: false,
        message: '删除项目级命令需要提供 projectPath'
      });
    }

    const result = service.deleteCommand(name, scope, projectPath || null, namespace || null);

    res.json({
      platform,
      success: result.success,
      message: result.message
    });
  } catch (err) {
    console.error('[Commands API] Delete command error:', err);
    sendApiError(res, err);
  }
});

// ==================== 仓库管理 API ====================

/**
 * 获取所有命令（包括远程仓库）
 * GET /api/commands/all
 * Query: projectPath, refresh=1 强制刷新缓存
 */
router.get('/all', async (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { projectPath, refresh } = req.query;
    const forceRefresh = refresh === '1';
    const result = await service.listAllCommands(projectPath || null, forceRefresh);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Commands API] List all commands error:', err);
    sendApiError(res, err);
  }
});

/**
 * 获取仓库列表
 * GET /api/commands/repos
 */
router.get('/repos', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const repos = service.getRepos();
    res.json({
      success: true,
      platform,
      repos
    });
  } catch (err) {
    console.error('[Commands API] Get repos error:', err);
    sendApiError(res, err);
  }
});

/**
 * 添加仓库
 * POST /api/commands/repos
 * Body: { owner, name, branch, directory, enabled }
 */
router.post('/repos', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
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
    console.error('[Commands API] Add repo error:', err);
    sendApiError(res, err);
  }
});

/**
 * 删除仓库
 * DELETE /api/commands/repos/:owner/:name
 * Query: directory - 可选，子目录路径
 */
router.delete('/repos/:owner/:name', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { owner, name } = req.params;
    const { directory = '' } = req.query;
    const repos = service.removeRepo(owner, name, directory);

    res.json({
      success: true,
      platform,
      repos
    });
  } catch (err) {
    console.error('[Commands API] Remove repo error:', err);
    sendApiError(res, err);
  }
});

/**
 * 切换仓库启用状态
 * PUT /api/commands/repos/:owner/:name/toggle
 * Body: { enabled, directory }
 */
router.put('/repos/:owner/:name/toggle', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { owner, name } = req.params;
    const { enabled, directory = '' } = req.body;

    const repos = service.toggleRepo(owner, name, directory, enabled);

    res.json({
      success: true,
      platform,
      repos
    });
  } catch (err) {
    console.error('[Commands API] Toggle repo error:', err);
    sendApiError(res, err);
  }
});

/**
 * 从远程仓库安装命令
 * POST /api/commands/install
 * Body: command object from listAllCommands
 */
router.post('/install', async (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const command = req.body;

    if (!command || !command.repoOwner || !command.repoName) {
      return res.status(400).json({
        success: false,
        message: 'Missing command info or repo info'
      });
    }

    const result = await service.installFromRemote(command);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Commands API] Install command error:', err);
    sendApiError(res, err);
  }
});

/**
 * 卸载命令
 * POST /api/commands/uninstall
 * Body: { path } - 命令的相对路径
 */
router.post('/uninstall', (req, res) => {
  try {
    const { platform, service } = getCommandsService(req);
    const { path } = req.body;

    if (!path) {
      return res.status(400).json({
        success: false,
        message: 'Missing path'
      });
    }

    const result = service.uninstallCommand(path);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Commands API] Uninstall command error:', err);
    sendApiError(res, err);
  }
});

module.exports = router;
