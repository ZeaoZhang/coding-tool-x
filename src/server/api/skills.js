/**
 * Skills API 路由
 */

const express = require('express');
const { SkillService } = require('../services/skill-service');

const router = express.Router();
const skillService = new SkillService();

/**
 * 获取技能列表
 * GET /api/skills
 * Query: refresh=1 强制刷新缓存
 */
router.get('/', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    const skills = await skillService.listSkills(forceRefresh);
    res.json({
      success: true,
      skills,
      total: skills.length,
      installed: skills.filter(s => s.installed).length
    });
  } catch (err) {
    console.error('[Skills API] List skills error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取技能详情（完整内容）
 * GET /api/skills/detail/:directory
 */
router.get('/detail/*', async (req, res) => {
  try {
    const directory = req.params[0]; // 获取通配符匹配的路径
    if (!directory) {
      return res.status(400).json({
        success: false,
        message: 'Missing directory'
      });
    }

    const result = await skillService.getSkillDetail(directory);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Get skill detail error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取已安装的技能
 * GET /api/skills/installed
 */
router.get('/installed', (req, res) => {
  try {
    const skills = skillService.getInstalledSkills();
    res.json({
      success: true,
      skills
    });
  } catch (err) {
    console.error('[Skills API] Get installed skills error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 安装技能
 * POST /api/skills/install
 * Body: { directory, fullDirectory, repo: { owner, name, branch } }
 * - directory: 本地安装目录（相对路径）
 * - fullDirectory: 仓库中的完整路径（当指定了仓库子目录时使用）
 */
router.post('/install', async (req, res) => {
  try {
    const { directory, fullDirectory, repo } = req.body;

    if (!directory) {
      return res.status(400).json({
        success: false,
        message: 'Missing directory'
      });
    }

    if (!repo || !repo.owner || !repo.name) {
      return res.status(400).json({
        success: false,
        message: 'Missing repo info'
      });
    }

    const result = await skillService.installSkill(
      directory,
      {
        owner: repo.owner,
        name: repo.name,
        branch: repo.branch || 'main'
      },
      fullDirectory || null  // 传递 fullDirectory 用于从仓库子目录下载
    );

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Install skill error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 创建自定义技能
 * POST /api/skills/create
 * Body: { name, directory, description, content }
 */
router.post('/create', (req, res) => {
  try {
    const { name, directory, description, content } = req.body;

    if (!directory) {
      return res.status(400).json({
        success: false,
        message: '请输入目录名称'
      });
    }

    // 校验目录名：只允许英文、数字、横杠、下划线
    if (!/^[a-zA-Z0-9_-]+$/.test(directory)) {
      return res.status(400).json({
        success: false,
        message: '目录名只能包含英文、数字、横杠和下划线'
      });
    }

    if (!content) {
      return res.status(400).json({
        success: false,
        message: '请输入技能内容'
      });
    }

    const result = skillService.createCustomSkill({
      name: name || directory,
      directory,
      description: description || '',
      content
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Create skill error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 卸载技能
 * POST /api/skills/uninstall
 * Body: { directory }
 */
router.post('/uninstall', (req, res) => {
  try {
    const { directory } = req.body;

    if (!directory) {
      return res.status(400).json({
        success: false,
        message: 'Missing directory'
      });
    }

    const result = skillService.uninstallSkill(directory);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Uninstall skill error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取仓库列表
 * GET /api/skills/repos
 */
router.get('/repos', (req, res) => {
  try {
    const repos = skillService.loadRepos();
    res.json({
      success: true,
      repos
    });
  } catch (err) {
    console.error('[Skills API] Get repos error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 添加仓库
 * POST /api/skills/repos
 * Body: { owner, name, branch, directory, enabled }
 * - directory: 可选，指定扫描的子目录路径
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

    const repos = skillService.addRepo({ owner, name, branch, directory, enabled });

    res.json({
      success: true,
      repos
    });
  } catch (err) {
    console.error('[Skills API] Add repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 删除仓库
 * DELETE /api/skills/repos/:owner/:name
 * Query: directory - 可选，子目录路径
 */
router.delete('/repos/:owner/:name', (req, res) => {
  try {
    const { owner, name } = req.params;
    const { directory = '' } = req.query;
    const repos = skillService.removeRepo(owner, name, directory);

    res.json({
      success: true,
      repos
    });
  } catch (err) {
    console.error('[Skills API] Remove repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 切换仓库启用状态
 * PUT /api/skills/repos/:owner/:name/toggle
 * Body: { enabled, directory }
 * - directory: 可选，子目录路径
 */
router.put('/repos/:owner/:name/toggle', (req, res) => {
  try {
    const { owner, name } = req.params;
    const { enabled, directory = '' } = req.body;

    const repos = skillService.toggleRepo(owner, name, directory, enabled);

    res.json({
      success: true,
      repos
    });
  } catch (err) {
    console.error('[Skills API] Toggle repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// ==================== 格式转换 API ====================

/**
 * 转换技能格式
 * POST /api/skills/convert
 * Body: { content, targetFormat }
 * - content: 技能内容
 * - targetFormat: 目标格式 ('claude' | 'codex')
 */
router.post('/convert', (req, res) => {
  try {
    const { content, targetFormat } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: '请提供技能内容'
      });
    }

    if (!['claude', 'codex'].includes(targetFormat)) {
      return res.status(400).json({
        success: false,
        message: '目标格式必须是 claude 或 codex'
      });
    }

    const result = skillService.convertSkillFormat(content, targetFormat);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Convert skill error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
