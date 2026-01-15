/**
 * Rules API 路由
 *
 * 管理 Claude Code 规则文件
 */

const express = require('express');
const { RulesService } = require('../services/rules-service');

const router = express.Router();
const rulesService = new RulesService();

/**
 * 获取规则列表
 * GET /api/rules
 * Query: projectPath - 项目路径（可选，用于获取项目级规则）
 */
router.get('/', (req, res) => {
  try {
    const { projectPath } = req.query;
    const result = rulesService.listRules(projectPath || null);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Rules API] List rules error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取规则统计
 * GET /api/rules/stats
 */
router.get('/stats', (req, res) => {
  try {
    const { projectPath } = req.query;
    const stats = rulesService.getStats(projectPath || null);

    res.json({
      success: true,
      ...stats
    });
  } catch (err) {
    console.error('[Rules API] Get stats error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取目录结构
 * GET /api/rules/tree
 */
router.get('/tree', (req, res) => {
  try {
    const { projectPath } = req.query;
    const tree = rulesService.getDirectoryTree(projectPath || null);

    res.json({
      success: true,
      tree
    });
  } catch (err) {
    console.error('[Rules API] Get tree error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取单个规则详情
 * GET /api/rules/:scope/*
 * 支持子目录路径，如 /api/rules/user/frontend/react
 */
router.get('/:scope/*', (req, res) => {
  try {
    const { scope } = req.params;
    const relativePath = req.params[0]; // 通配符匹配的路径
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
        message: '获取项目级规则需要提供 projectPath'
      });
    }

    const rule = rulesService.getRule(relativePath, scope, projectPath || null);

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: `规则 "${relativePath}" 不存在`
      });
    }

    res.json({
      success: true,
      rule
    });
  } catch (err) {
    console.error('[Rules API] Get rule error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 创建规则
 * POST /api/rules
 * Body: { fileName, scope, projectPath?, directory?, paths?, body }
 */
router.post('/', (req, res) => {
  try {
    const { fileName, scope, projectPath, directory, paths, body } = req.body;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        message: '规则文件名不能为空'
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
        message: '创建项目级规则需要提供 projectPath'
      });
    }

    const rule = rulesService.createRule({
      fileName,
      scope,
      projectPath: projectPath || null,
      directory: directory || null,
      paths: paths || '',
      body: body || ''
    });

    res.json({
      success: true,
      rule,
      message: '规则创建成功'
    });
  } catch (err) {
    console.error('[Rules API] Create rule error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 更新规则
 * PUT /api/rules/:scope/*
 */
router.put('/:scope/*', (req, res) => {
  try {
    const { scope } = req.params;
    const relativePath = req.params[0];
    const { projectPath, paths, body } = req.body;

    if (!['user', 'project'].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: '无效的 scope，必须是 user 或 project'
      });
    }

    if (scope === 'project' && !projectPath) {
      return res.status(400).json({
        success: false,
        message: '更新项目级规则需要提供 projectPath'
      });
    }

    // 确保路径以 .md 结尾
    const fullPath = relativePath.endsWith('.md') ? relativePath : `${relativePath}.md`;

    const rule = rulesService.updateRule({
      relativePath: fullPath,
      scope,
      projectPath: projectPath || null,
      paths: paths || '',
      body: body || ''
    });

    res.json({
      success: true,
      rule,
      message: '规则更新成功'
    });
  } catch (err) {
    console.error('[Rules API] Update rule error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 删除规则
 * DELETE /api/rules/:scope/*
 */
router.delete('/:scope/*', (req, res) => {
  try {
    const { scope } = req.params;
    const relativePath = req.params[0];
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
        message: '删除项目级规则需要提供 projectPath'
      });
    }

    // 确保路径以 .md 结尾
    const fullPath = relativePath.endsWith('.md') ? relativePath : `${relativePath}.md`;

    const result = rulesService.deleteRule(fullPath, scope, projectPath || null);

    res.json({
      success: result.success,
      message: result.message
    });
  } catch (err) {
    console.error('[Rules API] Delete rule error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// ==================== 仓库管理 API ====================

/**
 * 获取所有规则（包括远程仓库）
 * GET /api/rules/all
 * Query: projectPath, refresh=1 强制刷新缓存
 */
router.get('/all', async (req, res) => {
  try {
    const { projectPath, refresh } = req.query;
    const forceRefresh = refresh === '1';
    const result = await rulesService.listAllRules(projectPath || null, forceRefresh);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Rules API] List all rules error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取仓库列表
 * GET /api/rules/repos
 */
router.get('/repos', (req, res) => {
  try {
    const repos = rulesService.getRepos();
    res.json({
      success: true,
      repos
    });
  } catch (err) {
    console.error('[Rules API] Get repos error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 添加仓库
 * POST /api/rules/repos
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

    const repos = rulesService.addRepo({ owner, name, branch, directory, enabled });

    res.json({
      success: true,
      repos
    });
  } catch (err) {
    console.error('[Rules API] Add repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 删除仓库
 * DELETE /api/rules/repos/:owner/:name
 * Query: directory - 可选，子目录路径
 */
router.delete('/repos/:owner/:name', (req, res) => {
  try {
    const { owner, name } = req.params;
    const { directory = '' } = req.query;
    const repos = rulesService.removeRepo(owner, name, directory);

    res.json({
      success: true,
      repos
    });
  } catch (err) {
    console.error('[Rules API] Remove repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 切换仓库启用状态
 * PUT /api/rules/repos/:owner/:name/toggle
 * Body: { enabled, directory }
 */
router.put('/repos/:owner/:name/toggle', (req, res) => {
  try {
    const { owner, name } = req.params;
    const { enabled, directory = '' } = req.body;

    const repos = rulesService.toggleRepo(owner, name, directory, enabled);

    res.json({
      success: true,
      repos
    });
  } catch (err) {
    console.error('[Rules API] Toggle repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 从远程仓库安装规则
 * POST /api/rules/install
 * Body: rule object from listAllRules
 */
router.post('/install', async (req, res) => {
  try {
    const rule = req.body;

    if (!rule || !rule.repoOwner || !rule.repoName) {
      return res.status(400).json({
        success: false,
        message: 'Missing rule info or repo info'
      });
    }

    const result = await rulesService.installFromRemote(rule);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Rules API] Install rule error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 卸载规则
 * POST /api/rules/uninstall
 * Body: { path } - 规则的相对路径
 */
router.post('/uninstall', (req, res) => {
  try {
    const { path } = req.body;

    if (!path) {
      return res.status(400).json({
        success: false,
        message: 'Missing path'
      });
    }

    const result = rulesService.uninstallRule(path);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Rules API] Uninstall rule error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
