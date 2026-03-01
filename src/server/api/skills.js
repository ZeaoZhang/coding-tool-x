/**
 * Skills API 路由
 */

const express = require('express');
const { SkillService } = require('../services/skill-service');

const router = express.Router();
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode'];
const skillServices = new Map();

function resolvePlatform(rawPlatform) {
  return SUPPORTED_PLATFORMS.includes(rawPlatform) ? rawPlatform : 'claude';
}

function getPlatform(req) {
  return resolvePlatform(req.query?.platform || req.body?.platform);
}

function getSkillService(req) {
  const platform = getPlatform(req);
  if (!skillServices.has(platform)) {
    skillServices.set(platform, new SkillService(platform));
  }
  return { platform, service: skillServices.get(platform) };
}

/**
 * 获取技能列表
 * GET /api/skills
 * Query: refresh=1 强制刷新缓存
 */
router.get('/', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const forceRefresh = req.query.refresh === '1';
    const skills = await service.listSkills(forceRefresh);
    res.json({
      success: true,
      platform,
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
    const { platform, service } = getSkillService(req);
    const directory = req.params[0]; // 获取通配符匹配的路径
    if (!directory) {
      return res.status(400).json({
        success: false,
        message: 'Missing directory'
      });
    }

    const result = await service.getSkillDetail(directory);
    res.json({
      success: true,
      platform,
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
    const { platform, service } = getSkillService(req);
    const skills = service.getInstalledSkills();
    res.json({
      success: true,
      platform,
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
    const { platform, service } = getSkillService(req);
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

    const result = await service.installSkill(
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
      platform,
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
    const { platform, service } = getSkillService(req);
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

    const result = service.createCustomSkill({
      name: name || directory,
      directory,
      description: description || '',
      content
    });

    res.json({
      success: true,
      platform,
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
    const { platform, service } = getSkillService(req);
    const { directory } = req.body;

    if (!directory) {
      return res.status(400).json({
        success: false,
        message: 'Missing directory'
      });
    }

    const result = service.uninstallSkill(directory);

    res.json({
      success: true,
      platform,
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
    const { platform, service } = getSkillService(req);
    const repos = service.loadRepos();
    res.json({
      success: true,
      platform,
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
    const { platform, service } = getSkillService(req);
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
    const { platform, service } = getSkillService(req);
    const { owner, name } = req.params;
    const { directory = '' } = req.query;
    const repos = service.removeRepo(owner, name, directory);

    res.json({
      success: true,
      platform,
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
    const { platform, service } = getSkillService(req);
    const { owner, name } = req.params;
    const { enabled, directory = '' } = req.body;

    const repos = service.toggleRepo(owner, name, directory, enabled);

    res.json({
      success: true,
      platform,
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

// ==================== 多文件技能管理 API ====================

/**
 * 创建带多文件的技能
 * POST /api/skills/create-with-files
 * Body: { directory, files: [{path, content, isBase64?}] }
 */
router.post('/create-with-files', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory, files } = req.body;

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

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供文件列表'
      });
    }

    const result = service.createSkillWithFiles({ directory, files });

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Create skill with files error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取技能文件列表
 * GET /api/skills/:directory/files
 */
router.get('/:directory/files', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const files = service.getSkillFiles(directory);

    res.json({
      success: true,
      platform,
      directory,
      files
    });
  } catch (err) {
    console.error('[Skills API] Get skill files error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取技能文件内容
 * GET /api/skills/:directory/files/:filePath
 * 注意：filePath 可能包含子目录，使用通配符
 */
router.get('/:directory/file/*', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const filePath = req.params[0];

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '请指定文件路径'
      });
    }

    const result = service.getSkillFileContent(directory, filePath);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Get skill file content error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 添加文件到技能
 * POST /api/skills/:directory/files
 * Body: { files: [{path, content, isBase64?}] }
 */
router.post('/:directory/files', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供文件列表'
      });
    }

    const result = service.addSkillFiles(directory, files);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Add skill files error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 删除技能中的文件
 * DELETE /api/skills/:directory/file/*
 */
router.delete('/:directory/file/*', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const filePath = req.params[0];

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '请指定文件路径'
      });
    }

    const result = service.deleteSkillFile(directory, filePath);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Delete skill file error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 更新技能文件内容
 * PUT /api/skills/:directory/file/*
 * Body: { content, isBase64? }
 */
router.put('/:directory/file/*', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const filePath = req.params[0];
    const { content, isBase64 = false } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '请指定文件路径'
      });
    }

    if (content === undefined) {
      return res.status(400).json({
        success: false,
        message: '请提供文件内容'
      });
    }

    const result = service.updateSkillFile(directory, filePath, content, isBase64);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Update skill file error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
