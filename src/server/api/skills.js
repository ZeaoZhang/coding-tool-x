/**
 * Skills API 路由
 */

const express = require('express');
const { SkillService } = require('../services/skill-service');
const { maskToken } = require('../services/oauth-utils');
const { sendApiError } = require('./validation-errors');
const { resolveManagedPlatform } = require('../services/platform-resolution');
const { validateKnownProjectCwd } = require('../services/project-path-validation');
const {
  readOmpSkillSettings,
  updateOmpSkillSettings
} = require('../services/omp-skill-settings-service');

const router = express.Router();
const skillServices = new Map();

function resolvePlatform(rawPlatform) {
  return resolveManagedPlatform(rawPlatform);
}

function getPlatform(req) {
  return resolvePlatform(req.query?.platform || req.body?.platform);
}

function getSkillService(req) {
  const resolution = getPlatform(req);
  const platform = resolution.platform;
  if (!skillServices.has(platform)) {
    skillServices.set(platform, new SkillService(platform));
  }
  return {
    platform,
    service: skillServices.get(platform),
    warning: resolution.warning
  };
}

function extractRepoPayload(source = {}) {
  const repo = source.repo && typeof source.repo === 'object' ? source.repo : source;
  return {
    id: repo.id || source.repoId || '',
    provider: repo.provider || source.provider || '',
    host: repo.host || source.host || '',
    owner: repo.owner || source.owner || '',
    name: repo.name || source.name || '',
    branch: repo.branch || source.branch || '',
    directory: repo.directory || source.directory || '',
    projectPath: repo.projectPath || source.projectPath || '',
    localPath: repo.localPath || source.localPath || '',
    repoUrl: repo.repoUrl || source.repoUrl || '',
    token: repo.token || source.token || ''
  };
}

function sanitizeRepo(repo = {}) {
  const token = String(repo.token || '').trim();
  const sanitized = {
    ...repo,
    hasToken: Boolean(token),
    tokenPreview: token ? maskToken(token) : ''
  };
  delete sanitized.token;
  return sanitized;
}

function sanitizeRepos(service, repos = []) {
  if (typeof service.getReposForClient === 'function') {
    return service.getReposForClient(repos);
  }
  return (Array.isArray(repos) ? repos : []).map(sanitizeRepo);
}

/**
 * 获取技能列表
 * GET /api/skills
 * Query: refresh=1 强制刷新缓存
 */
router.get('/', async (req, res) => {
  try {
    const { platform, service, warning } = getSkillService(req);
    const forceRefresh = req.query.refresh === '1';
    const cwd = await validateKnownProjectCwd(req.query.cwd);
    if (forceRefresh) {
      console.log(`[Skills API] Refreshing skills for ${platform}...`);
    }
    const skills = await service.listSkills(forceRefresh, { cwd });
    console.log(`[Skills API] ${platform}: ${skills.length} skills loaded (refresh=${forceRefresh})`);
    res.json({
      success: true,
      platform,
      skills,
      total: skills.length,
      installed: skills.filter(s => s.installed).length,
      ...(warning ? { warnings: [warning] } : {})
    });
  } catch (err) {
    console.error('[Skills API] List skills error:', err);
    sendApiError(res, err);
  }
});

/**
 * 获取 OMP 技能设置
 * GET /api/skills/omp-settings
 */
router.get('/omp-settings', (req, res) => {
  try {
    const settings = readOmpSkillSettings();
    res.json({ success: true, settings });
  } catch (err) {
    console.error('[Skills API] Get OMP skill settings error:', err);
    sendApiError(res, err);
  }
});

/**
 * 更新 OMP 技能设置
 * PUT /api/skills/omp-settings
 */
router.put('/omp-settings', (req, res) => {
  try {
    const settings = updateOmpSkillSettings(req.body);
    res.json({ success: true, settings });
  } catch (err) {
    console.error('[Skills API] Update OMP skill settings error:', err);
    sendApiError(res, err);
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

    const repoHint = extractRepoPayload(req.query || {});
    const hasRepoHint = Object.values(repoHint).some(Boolean);
    const result = await service.getSkillDetail(directory, hasRepoHint ? repoHint : null, req.query.fullDirectory || '');
    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Get skill detail error:', err);
    sendApiError(res, err);
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
    sendApiError(res, err);
  }
});

/**
 * 安装技能
 * POST /api/skills/install
 * Body: { directory, fullDirectory, repo }
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

    if (!repo) {
      return res.status(400).json({
        success: false,
        message: 'Missing repo info'
      });
    }

    const result = await service.installSkill(
      directory,
      extractRepoPayload({ repo }),
      fullDirectory || null  // 传递 fullDirectory 用于从仓库子目录下载
    );

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Install skill error:', err);
    sendApiError(res, err);
  }
});

/**
 * 安装本地 cc-tool 托管的技能
 * POST /api/skills/install-local
 * Body: { directory }
 */
router.post('/install-local', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.body;

    if (!directory) {
      return res.status(400).json({ success: false, message: 'Missing directory' });
    }

    const result = service.installLocalSkill(directory);
    res.json({ success: true, platform, ...result });
  } catch (err) {
    console.error('[Skills API] Install local skill error:', err);
    sendApiError(res, err);
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
    sendApiError(res, err);
  }
});

/**
 * 卸载技能
 * POST /api/skills/uninstall
 * Body: { directory }
 */
router.post('/uninstall', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory, scope } = req.body;

    if (!directory) {
      return res.status(400).json({
        success: false,
        message: 'Missing directory'
      });
    }

    const cwd = await validateKnownProjectCwd(req.body.cwd);
    if (scope && scope !== 'user' && scope !== 'project') {
      throw new Error('Invalid scope: expected "user" or "project"');
    }
    if (scope === 'project' && !cwd) {
      throw new Error('Project scope requires a valid cwd');
    }
    const options = {
      ...(cwd ? { cwd } : {}),
      ...(scope ? { scope } : {})
    };
    const result = platform === 'omp' && Object.keys(options).length > 0
      ? service.uninstallSkill(directory, options)
      : service.uninstallSkill(directory);

    res.json({
      success: true,
      platform,
      ...result
    });
  } catch (err) {
    console.error('[Skills API] Uninstall skill error:', err);
    sendApiError(res, err);
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
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Skills API] Get repos error:', err);
    sendApiError(res, err);
  }
});

/**
 * 添加仓库
 * POST /api/skills/repos
 * Body: { provider, owner, name, host, projectPath, localPath, branch, directory, enabled }
 * - directory: 可选，指定扫描的子目录路径
 */
router.post('/repos', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const repo = extractRepoPayload(req.body);
    repo.enabled = req.body.enabled !== false;

    if (!repo.localPath && !repo.projectPath && (!repo.owner || !repo.name)) {
      return res.status(400).json({
        success: false,
        message: 'Missing repo info'
      });
    }

    const repos = service.addRepo(repo);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Skills API] Add repo error:', err);
    sendApiError(res, err);
  }
});

router.delete('/repos', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { id = '', owner = '', name = '', directory = '' } = req.query;
    const repos = service.removeRepo(owner, name, directory, id);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Skills API] Remove repo error:', err);
    sendApiError(res, err);
  }
});

router.put('/repos/toggle', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { id = '', owner = '', name = '', enabled, directory = '' } = req.body;

    const repos = service.toggleRepo(owner, name, directory, enabled, id);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Skills API] Toggle repo error:', err);
    sendApiError(res, err);
  }
});

router.put('/repos/auth', (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const {
      id = '',
      owner = '',
      name = '',
      directory = '',
      token = '',
      clearToken = false
    } = req.body;

    if (!clearToken && !String(token || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Missing token'
      });
    }

    const repos = service.updateRepoAuth(owner, name, directory, token, clearToken, id);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Skills API] Update repo auth error:', err);
    sendApiError(res, err);
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
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Skills API] Remove repo error:', err);
    sendApiError(res, err);
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
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Skills API] Toggle repo error:', err);
    sendApiError(res, err);
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
    sendApiError(res, err);
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
    sendApiError(res, err);
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
    sendApiError(res, err);
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
    sendApiError(res, err);
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
    sendApiError(res, err);
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
    sendApiError(res, err);
  }
});

module.exports = router;
