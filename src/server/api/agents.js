/**
 * Agents API 路由
 *
 * 管理 Claude Code 自定义代理
 */

const express = require('express');
const { AgentsService } = require('../services/agents-service');

const router = express.Router();
const agentsService = new AgentsService();

/**
 * 获取代理列表
 * GET /api/agents
 * Query: projectPath - 项目路径（可选，用于获取项目级代理）
 */
router.get('/', (req, res) => {
  try {
    const { projectPath } = req.query;
    const result = agentsService.listAgents(projectPath || null);

    res.json({
      success: true,
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
    const { projectPath } = req.query;
    const stats = agentsService.getStats(projectPath || null);

    res.json({
      success: true,
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
    const { scope, fileName } = req.params;
    const { projectPath } = req.query;

    if (!['user', 'project'].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: '无效的 scope，必须是 user 或 project'
      });
    }

    if (scope === 'project' && !projectPath) {
      return res.status(400).json({
        success: false,
        message: '获取项目级代理需要提供 projectPath'
      });
    }

    const agent = agentsService.getAgent(fileName, scope, projectPath || null);

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: `代理 "${fileName}" 不存在`
      });
    }

    res.json({
      success: true,
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
    const { fileName, scope, projectPath, name, description, tools, model, permissionMode, skills, systemPrompt } = req.body;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        message: '代理文件名不能为空'
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
        message: '创建项目级代理需要提供 projectPath'
      });
    }

    const agent = agentsService.createAgent({
      fileName,
      scope,
      projectPath: projectPath || null,
      name: name || fileName,
      description: description || '',
      tools: tools || '',
      model: model || '',
      permissionMode: permissionMode || '',
      skills: skills || '',
      systemPrompt: systemPrompt || ''
    });

    res.json({
      success: true,
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
    const { scope, fileName } = req.params;
    const { projectPath, name, description, tools, model, permissionMode, skills, systemPrompt } = req.body;

    if (!['user', 'project'].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: '无效的 scope，必须是 user 或 project'
      });
    }

    if (scope === 'project' && !projectPath) {
      return res.status(400).json({
        success: false,
        message: '更新项目级代理需要提供 projectPath'
      });
    }

    const agent = agentsService.updateAgent({
      fileName,
      scope,
      projectPath: projectPath || null,
      name: name || fileName,
      description: description || '',
      tools: tools || '',
      model: model || '',
      permissionMode: permissionMode || '',
      skills: skills || '',
      systemPrompt: systemPrompt || ''
    });

    res.json({
      success: true,
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
    const { scope, fileName } = req.params;
    const { projectPath } = req.query;

    if (!['user', 'project'].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: '无效的 scope，必须是 user 或 project'
      });
    }

    if (scope === 'project' && !projectPath) {
      return res.status(400).json({
        success: false,
        message: '删除项目级代理需要提供 projectPath'
      });
    }

    const result = agentsService.deleteAgent(fileName, scope, projectPath || null);

    res.json({
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
    const { projectPath, refresh } = req.query;
    const forceRefresh = refresh === '1';
    const result = await agentsService.listAllAgents(projectPath || null, forceRefresh);

    res.json({
      success: true,
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
    const repos = agentsService.getRepos();
    res.json({
      success: true,
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
    const { owner, name, branch = 'main', directory = '', enabled = true } = req.body;

    if (!owner || !name) {
      return res.status(400).json({
        success: false,
        message: 'Missing owner or name'
      });
    }

    const repos = agentsService.addRepo({ owner, name, branch, directory, enabled });

    res.json({
      success: true,
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
    const { owner, name } = req.params;
    const { directory = '' } = req.query;
    const repos = agentsService.removeRepo(owner, name, directory);

    res.json({
      success: true,
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
    const { owner, name } = req.params;
    const { enabled, directory = '' } = req.body;

    const repos = agentsService.toggleRepo(owner, name, directory, enabled);

    res.json({
      success: true,
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
    const agent = req.body;

    if (!agent || !agent.repoOwner || !agent.repoName) {
      return res.status(400).json({
        success: false,
        message: 'Missing agent info or repo info'
      });
    }

    const result = await agentsService.installFromRemote(agent);

    res.json({
      success: true,
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
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        message: 'Missing fileName'
      });
    }

    const result = agentsService.uninstallAgent(fileName);

    res.json({
      success: true,
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
