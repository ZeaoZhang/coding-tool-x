/**
 * Skills API 路由
 */

const express = require('express');
const { SkillService } = require('../services/skill-service');
const { ControlManifestStore } = require('../services/control-manifest-store');
const { EffectiveControlService } = require('../services/effective-control-service');
const { SkillProjectionService } = require('../services/skill-projection-service');
const { SkillRefreshTaskService } = require('../services/skill-refresh-task-service');
const { PATHS } = require('../../config/paths');
const { maskToken } = require('../services/oauth-utils');
const { sendApiError } = require('./validation-errors');
const { resolveManagedPlatform } = require('../services/platform-resolution');
const { validateKnownProjectCwd } = require('../services/project-path-validation');
const {
  readOmpSkillSettings,
  updateOmpSkillSettings
} = require('../../platforms/drivers/omp/skill-settings');

const router = express.Router();
const skillServices = new Map();
let routerOptions = {};
let defaultControlService;
let defaultRefreshTasks;

function resolvePlatform(rawPlatform) {
  return resolveManagedPlatform(rawPlatform);
}

function getPlatform(req) {
  return resolvePlatform(req.query?.platform || req.body?.platform);
}

function getSkillServiceForPlatform(platform) {
  if (typeof routerOptions.skillServiceFactory === 'function') {
    return routerOptions.skillServiceFactory(platform);
  }
  if (!skillServices.has(platform)) {
    skillServices.set(platform, new SkillService(platform));
  }
  return skillServices.get(platform);
}

function getSkillService(req) {
  const resolution = getPlatform(req);
  return {
    platform: resolution.platform,
    service: getSkillServiceForPlatform(resolution.platform),
    warning: resolution.warning
  };
}

function getControlService() {
  if (routerOptions.controlService) return routerOptions.controlService;
  if (!defaultControlService && PATHS.effectiveControlManifest) {
    const registry = require('../../platforms/runtime').getPlatformRegistry();
    defaultControlService = new EffectiveControlService({
      store: new ControlManifestStore({
        userPath: PATHS.effectiveControlManifest,
        projectPathResolver: ({ projectPath }) => require('path').join(projectPath, '.ctx-control.json')
      }),
      projection: new SkillProjectionService({ registry })
    });
  }
  return defaultControlService;
}

function getRefreshTasks() {
  if (routerOptions.refreshTasks) return routerOptions.refreshTasks;
  if (!defaultRefreshTasks && PATHS.skillRefreshTasks) {
    defaultRefreshTasks = new SkillRefreshTaskService({
      persistencePath: PATHS.skillRefreshTasks,
      worker: context => getSkillServiceForPlatform(context.platform).refreshRemoteSkills(context)
    });
  }
  return defaultRefreshTasks;
}

function createRouter(options = {}) {
  routerOptions = options;
  return router;
}

async function getScopeOptions(source = {}) {
  const scope = source.scope;
  if (scope && scope !== 'user' && scope !== 'project') {
    throw new Error('Invalid scope: expected "user" or "project"');
  }

  const cwd = await validateKnownProjectCwd(source.cwd);
  if (scope === 'project' && !cwd) {
    throw new Error('Project scope requires a valid cwd');
  }

  return {
    ...(cwd ? { cwd } : {}),
    ...(scope ? { scope } : {})
  };
}

function toControlScopeOptions(options = {}) {
  const scope = options.scope || 'user';
  return {
    scope,
    projectPath: scope === 'project' ? options.cwd : null
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
 * 获取本地 Skill 列表
 * GET /api/skills
 *
 * `refresh=1` is intentionally ignored here. Remote work only starts through
 * POST /refresh.
 */
router.get('/', async (req, res) => {
  try {
    const { platform, service, warning } = getSkillService(req);
    const options = { ...(await getScopeOptions(req.query)), scope: req.query.scope || 'user' };
    const snapshot = typeof service.scanSkills === 'function'
      ? await service.scanSkills(options)
      : {
        skills: await service.listSkills(false, options),
        refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
      };
    const skills = Array.isArray(snapshot.skills) ? snapshot.skills : [];
    const refreshService = getRefreshTasks();
    const refreshOptions = {
      platform,
      scope: options.scope || 'user',
      projectPath: options.scope === 'project' ? options.cwd : null
    };
    const activeTask = refreshService?.getActive?.(refreshOptions);
    const latestTask = activeTask || refreshService?.listRecent?.(refreshOptions)?.[0];
    if (latestTask) {
      snapshot.refresh = {
        ...(snapshot.refresh || {}),
        state: latestTask.status,
        taskId: latestTask.id,
        error: latestTask.error || snapshot.refresh?.error || null
      };
    }
    res.json({
      success: true,
      platform,
      ...snapshot,
      total: skills.length,
      ...(warning ? { warnings: [warning] } : {})
    });
  } catch (err) {
    console.error('[Skills API] List skills error:', err);
    sendApiError(res, err);
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { platform } = getSkillService(req);
    const options = await getScopeOptions(req.body);
    const refreshTasks = getRefreshTasks();
    if (!refreshTasks) throw new Error('Skill refresh task service is unavailable');
    const task = refreshTasks.enqueue({
      platform,
      scope: options.scope || 'user',
      projectPath: options.scope === 'project' ? options.cwd : null,
      reason: 'manual'
    });
    res.status(202).json({ success: true, platform, task });
  } catch (err) {
    console.error('[Skills API] Refresh skills error:', err);
    sendApiError(res, err);
  }
});

router.get('/refresh/:taskId', async (req, res) => {
  try {
    const { platform } = getSkillService(req);
    const options = await getScopeOptions(req.query);
    const refreshTasks = getRefreshTasks();
    const task = refreshTasks?.get(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Refresh task not found' });
    const taskScope = task.scope || 'user';
    const taskProjectPath = taskScope === 'project' ? (task.projectPath || null) : null;
    const requestedProjectPath = options.scope === 'project' ? (options.cwd || null) : null;
    if (
      task.platform !== platform
      || taskScope !== (options.scope || 'user')
      || taskProjectPath !== requestedProjectPath
    ) {
      return res.status(404).json({ success: false, message: 'Refresh task not found' });
    }
    return res.json({ success: true, task });
  } catch (err) {
    console.error('[Skills API] Get refresh task error:', err);
    return sendApiError(res, err);
  }
});

router.put('/toggle', async (req, res) => {
  try {
    const { platform } = getSkillService(req);
    if (!req.body?.controlKey) {
      return res.status(400).json({ success: false, message: 'Missing controlKey' });
    }
    const options = await getScopeOptions(req.body);
    const controlService = getControlService();
    if (!controlService) throw new Error('Effective control service is unavailable');
    const result = controlService.setSkillEnabled({
      platform,
      controlKey: req.body.controlKey,
      enabled: req.body.enabled,
      ...toControlScopeOptions(options)
    });
    return res.json({ success: true, platform, ...result });
  } catch (err) {
    console.error('[Skills API] Toggle skill error:', err);
    return sendApiError(res, err);
  }
});

router.put('/trust', async (req, res) => {
  try {
    const { platform } = getSkillService(req);
    if (!req.body?.controlKey) {
      return res.status(400).json({ success: false, message: 'Missing controlKey' });
    }
    const options = await getScopeOptions(req.body);
    const controlService = getControlService();
    if (!controlService) throw new Error('Effective control service is unavailable');
    const result = controlService.setSkillTrust({
      platform,
      controlKey: req.body.controlKey,
      trust: req.body.trust,
      ...toControlScopeOptions(options)
    });
    return res.json({ success: true, platform, ...result });
  } catch (err) {
    console.error('[Skills API] Set Skill trust error:', err);
    return sendApiError(res, err);
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

    const options = await getScopeOptions(req.query);
    const repoHint = extractRepoPayload(req.query || {});
    const hasRepoHint = Object.values(repoHint).some(Boolean);
    const result = Object.keys(options).length > 0
      ? await service.getSkillDetail(
        directory,
        hasRepoHint ? repoHint : null,
        req.query.fullDirectory || '',
        options
      )
      : await service.getSkillDetail(
        directory,
        hasRepoHint ? repoHint : null,
        req.query.fullDirectory || ''
      );
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
router.get('/installed', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const options = await getScopeOptions(req.query);
    const snapshot = await service.scanSkills(options);
    res.json({
      success: true,
      platform,
      ...snapshot,
      total: Array.isArray(snapshot.skills) ? snapshot.skills.length : 0
    });
  } catch (err) {
    console.error('[Skills API] Get installed skills error:', err);
    sendApiError(res, err);
  }
});

/**
 * 旧安装入口已被 Skill control plane 取代。
 */
router.post('/install', (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Skill installation is replaced by POST /api/skills/refresh and PUT /api/skills/toggle'
  });
});

/**
 * 旧本地安装入口已被 Skill control plane 取代。
 */
router.post('/install-local', (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Skill installation is replaced by PUT /api/skills/toggle'
  });
});

/**
 * 创建自定义技能
 * POST /api/skills/create
 * Body: { name, directory, description, content }
 */
router.post('/create', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { name, directory, description, content } = req.body;
    const options = await getScopeOptions(req.body);

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
    const result = await service.createCustomSkill({
      name: name || directory,
      directory,
      description: description || '',
      content,
      ...options
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
 * 旧卸载入口已被 Skill toggle 取代。
 */
router.post('/uninstall', (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Skill uninstallation is replaced by PUT /api/skills/toggle'
  });
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
router.post('/create-with-files', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory, files } = req.body;
    const options = await getScopeOptions(req.body);

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

    const result = await service.createSkillWithFiles({ directory, files, ...options });

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
router.get('/:directory/files', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const options = await getScopeOptions(req.query);
    const files = Object.keys(options).length > 0
      ? service.getSkillFiles(directory, options)
      : service.getSkillFiles(directory);
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
router.get('/:directory/file/*', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const options = await getScopeOptions(req.query);
    const filePath = req.params[0];

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '请指定文件路径'
      });
    }

    const result = Object.keys(options).length > 0
      ? service.getSkillFileContent(directory, filePath, options)
      : service.getSkillFileContent(directory, filePath);

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
router.post('/:directory/files', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const { files } = req.body;
    const options = await getScopeOptions(req.body);

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供文件列表'
      });
    }

    const result = Object.keys(options).length > 0
      ? service.addSkillFiles(directory, files, options)
      : service.addSkillFiles(directory, files);

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
router.delete('/:directory/file/*', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const options = await getScopeOptions(req.query);
    const filePath = req.params[0];

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '请指定文件路径'
      });
    }

    const result = Object.keys(options).length > 0
      ? service.deleteSkillFile(directory, filePath, options)
      : service.deleteSkillFile(directory, filePath);

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
router.put('/:directory/file/*', async (req, res) => {
  try {
    const { platform, service } = getSkillService(req);
    const { directory } = req.params;
    const options = await getScopeOptions(req.body);
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

    const result = Object.keys(options).length > 0
      ? service.updateSkillFile(directory, filePath, content, isBase64, options)
      : service.updateSkillFile(directory, filePath, content, isBase64);

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

router.createRouter = createRouter;
module.exports = router;
