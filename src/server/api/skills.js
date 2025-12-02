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
 * Body: { directory, repo: { owner, name, branch } }
 */
router.post('/install', async (req, res) => {
  try {
    const { directory, repo } = req.body;

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

    const result = await skillService.installSkill(directory, {
      owner: repo.owner,
      name: repo.name,
      branch: repo.branch || 'main'
    });

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
 * Body: { owner, name, branch, enabled }
 */
router.post('/repos', (req, res) => {
  try {
    const { owner, name, branch = 'main', enabled = true } = req.body;

    if (!owner || !name) {
      return res.status(400).json({
        success: false,
        message: 'Missing owner or name'
      });
    }

    const repos = skillService.addRepo({ owner, name, branch, enabled });

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
 */
router.delete('/repos/:owner/:name', (req, res) => {
  try {
    const { owner, name } = req.params;
    const repos = skillService.removeRepo(owner, name);

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
 * Body: { enabled }
 */
router.put('/repos/:owner/:name/toggle', (req, res) => {
  try {
    const { owner, name } = req.params;
    const { enabled } = req.body;

    const repos = skillService.toggleRepo(owner, name, enabled);

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

module.exports = router;
