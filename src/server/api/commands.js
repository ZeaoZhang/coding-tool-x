/**
 * Commands API 路由
 *
 * 管理 Claude Code 自定义命令
 */

const express = require('express');
const { CommandsService } = require('../services/commands-service');

const router = express.Router();
const commandsService = new CommandsService();

/**
 * 获取命令列表
 * GET /api/commands
 * Query: projectPath - 项目路径（可选，用于获取项目级命令）
 */
router.get('/', (req, res) => {
  try {
    const { projectPath } = req.query;
    const result = commandsService.listCommands(projectPath || null);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Commands API] List commands error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取命令统计
 * GET /api/commands/stats
 */
router.get('/stats', (req, res) => {
  try {
    const { projectPath } = req.query;
    const stats = commandsService.getStats(projectPath || null);

    res.json({
      success: true,
      ...stats
    });
  } catch (err) {
    console.error('[Commands API] Get stats error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取单个命令详情
 * GET /api/commands/:scope/:name
 * GET /api/commands/:scope/ns/:namespace/:name
 */
router.get('/:scope/:name', (req, res) => {
  try {
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

    const command = commandsService.getCommand(name, scope, projectPath || null, namespace || null);

    if (!command) {
      return res.status(404).json({
        success: false,
        message: `命令 "${name}" 不存在`
      });
    }

    res.json({
      success: true,
      command
    });
  } catch (err) {
    console.error('[Commands API] Get command error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 创建命令
 * POST /api/commands
 * Body: { name, scope, projectPath?, namespace?, description?, allowedTools?, argumentHint?, body }
 */
router.post('/', (req, res) => {
  try {
    const { name, scope, projectPath, namespace, description, allowedTools, argumentHint, body } = req.body;

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

    const command = commandsService.createCommand({
      name,
      scope,
      projectPath: projectPath || null,
      namespace: namespace || null,
      description: description || '',
      allowedTools: allowedTools || '',
      argumentHint: argumentHint || '',
      body: body || ''
    });

    res.json({
      success: true,
      command,
      message: '命令创建成功'
    });
  } catch (err) {
    console.error('[Commands API] Create command error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 更新命令
 * PUT /api/commands/:scope/:name
 */
router.put('/:scope/:name', (req, res) => {
  try {
    const { scope, name } = req.params;
    const { projectPath, namespace, description, allowedTools, argumentHint, body } = req.body;

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

    const command = commandsService.updateCommand({
      name,
      scope,
      projectPath: projectPath || null,
      namespace: namespace || null,
      description: description || '',
      allowedTools: allowedTools || '',
      argumentHint: argumentHint || '',
      body: body || ''
    });

    res.json({
      success: true,
      command,
      message: '命令更新成功'
    });
  } catch (err) {
    console.error('[Commands API] Update command error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 删除命令
 * DELETE /api/commands/:scope/:name
 */
router.delete('/:scope/:name', (req, res) => {
  try {
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

    const result = commandsService.deleteCommand(name, scope, projectPath || null, namespace || null);

    res.json({
      success: result.success,
      message: result.message
    });
  } catch (err) {
    console.error('[Commands API] Delete command error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
