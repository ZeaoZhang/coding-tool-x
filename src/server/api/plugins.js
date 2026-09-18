/**
 * Plugins API 路由
 *
 * 管理 CTX 插件系统
 */

const express = require('express');
const path = require('path');
const { PluginsService } = require('../services/plugins-service');
const { SkillRefreshTaskService } = require('../services/skill-refresh-task-service');
const { PATHS } = require('../../config/paths');
const { maskToken } = require('../services/oauth-utils');
const { sendApiError } = require('./validation-errors');
const { resolveManagedPlatform } = require('../services/platform-resolution');
const { validateKnownProjectCwd } = require('../services/project-path-validation');

const router = express.Router();
const pluginServices = new Map();
let routerOptions = {};
let defaultRefreshTasks;

router.createRouter = (options = {}) => {
  routerOptions = options;
  return router;
};

function resolvePlatform(rawPlatform) {
  return resolveManagedPlatform(rawPlatform);
}

function getPlatform(req) {
  return resolvePlatform(req.query?.platform || req.body?.platform);
}

function getPluginsService(req) {
  const resolution = getPlatform(req);
  const platform = resolution.platform;
  if (!pluginServices.has(platform)) {
    pluginServices.set(platform, new PluginsService(platform));
  }
  return {
    platform,
    service: pluginServices.get(platform),
    warning: resolution.warning
  };
}

function getPluginServiceForPlatform(platform) {
  if (!pluginServices.has(platform)) {
    pluginServices.set(platform, new PluginsService(platform));
  }
  return pluginServices.get(platform);
}

function getRefreshTasks() {
  if (routerOptions.refreshTasks) return routerOptions.refreshTasks;
  if (!defaultRefreshTasks) {
    const persistencePath = PATHS.pluginRefreshTasks
      || path.join(PATHS.storage || process.cwd(), 'runtime', 'plugin-refresh-tasks.json');
    defaultRefreshTasks = new SkillRefreshTaskService({
      persistencePath,
      worker: context => getPluginServiceForPlatform(context.platform).refreshRemotePlugins(context)
    });
  }
  return defaultRefreshTasks;
}

async function getRequestOptions(req, service) {
  const scope = String(req.query?.scope || req.body?.scope || '').trim();
  if (scope && scope !== 'user' && scope !== 'project') {
    throw new Error('Invalid scope: expected "user" or "project"');
  }
  const cwd = await validateKnownProjectCwd(req.query?.cwd || req.body?.cwd);
  if (scope === 'project' && !cwd) {
    throw new Error('Project scope requires a valid cwd');
  }
  const requestData = {
    ...(cwd ? { cwd } : {}),
    ...(scope ? { scope } : {})
  };
  return typeof service?.getRequestOptions === 'function'
    ? service.getRequestOptions(requestData)
    : requestData;
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
    repoUrl: repo.repoUrl || repo.url || source.repoUrl || source.url || '',
    token: repo.token || source.token || '',
    marketplace: repo.marketplace || source.marketplace || '',
    source: repo.source || repo.sourceUri || source.source || source.sourceUri || ''
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
function normalizeInstallMetadata(service, requestBody, repoPayload) {
  if (typeof service?.normalizeInstallMetadata === 'function') {
    return service.normalizeInstallMetadata(requestBody, repoPayload);
  }
  if (repoPayload) return repoPayload;
  const metadata = requestBody.metadata && typeof requestBody.metadata === 'object'
    ? requestBody.metadata
    : {};
  if (Object.keys(metadata).length === 0 && !requestBody.pluginId && !requestBody.name) return null;
  return {
    ...metadata,
    name: requestBody.name || metadata.name,
    pluginId: requestBody.pluginId || metadata.pluginId,
    pluginKind: requestBody.pluginKind || metadata.pluginKind,
    marketplace: requestBody.marketplace || metadata.marketplace,
    installSource: requestBody.installSource || metadata.installSource,
    version: requestBody.version || metadata.version,
    description: requestBody.description || metadata.description,
    resourceTypes: requestBody.resourceTypes || metadata.resourceTypes
  };
}

function invokeWithOptions(method, args, options) {
  return Object.keys(options || {}).length > 0 ? method(...args, options) : method(...args);
}


/**
 * 获取平台插件能力
 * GET /api/plugins/capabilities
 */
router.get('/capabilities', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const capabilities = typeof service.getCapabilities === 'function'
      ? service.getCapabilities()
      : { platform, supportsPlugins: true };

    res.json({
      success: true,
      platform,
      capabilities
    });
  } catch (err) {
    console.error('[Plugins API] Get capabilities error:', err);
    sendApiError(res, err);
  }
});

/**
 * 获取插件列表
 * GET /api/plugins
 */
router.get('/', async (req, res) => {
  try {
    const { platform, service, warning } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const result = invokeWithOptions(service.listPlugins.bind(service), [], options);
    const plugins = typeof service.sanitizePluginList === 'function'
      ? service.sanitizePluginList(result.plugins)
      : result.plugins;

    res.json({
      success: true,
      platform,
      ...result,
      plugins,
      ...(warning ? { warnings: [warning] } : {})
    });
  } catch (err) {
    console.error('[Plugins API] List plugins error:', err);
    sendApiError(res, err);
  }
});

/**
 * 获取市场插件列表
 * GET /api/plugins/market
 */
router.get('/market', async (req, res) => {
  try {
    const { platform, service, warning } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const marketPlugins = await invokeWithOptions(service.getMarketPlugins.bind(service), [false], options);
    const plugins = typeof service.sanitizePluginList === 'function'
      ? service.sanitizePluginList(marketPlugins)
      : marketPlugins;
    console.log(`[Plugins API] ${platform}: ${plugins.length} cached market plugins loaded`);

    res.json({
      success: true,
      platform,
      plugins,
      ...(warning ? { warnings: [warning] } : {})
    });
  } catch (err) {
    console.error('[Plugins API] Get market plugins error:', err);
    sendApiError(res, err);
  }
});

/**
 * 启动插件远端全量缓存任务
 * POST /api/plugins/refresh
 */
router.post('/refresh', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const refreshTasks = getRefreshTasks();
    if (!refreshTasks) throw new Error('Plugin refresh task service is unavailable');
    const task = refreshTasks.enqueue({
      platform,
      scope: options.scope || 'user',
      projectPath: options.scope === 'project' ? options.cwd : null,
      reason: 'manual'
    });
    res.status(202).json({ success: true, platform, task });
  } catch (err) {
    console.error('[Plugins API] Refresh plugins error:', err);
    sendApiError(res, err);
  }
});

router.get('/refresh/:taskId', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const options = await getRequestOptions({ query: req.query }, service);
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
    console.error('[Plugins API] Get refresh task error:', err);
    return sendApiError(res, err);
  }
});

/**
 * 安装插件
 * POST /api/plugins/install
 * Body: { directory, repo: { owner, name, branch } } or { source }
 */
router.post('/install', async (req, res) => {
  try {
    const { platform, service, warning } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const { directory, repo, gitUrl, source, pluginId } = req.body;
    const hasDirectoryField = Object.prototype.hasOwnProperty.call(req.body, 'directory');

    // Support both new format (directory + repo) and legacy format (gitUrl)
    let installUrl;
    if (pluginId || source) {
      installUrl = pluginId || source;
    } else if (repo && hasDirectoryField) {
      installUrl = '';
    } else if (gitUrl) {
      installUrl = gitUrl;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Either source, (directory + repo), or gitUrl is required'
      });
    }

    const repoMetadata = normalizeInstallMetadata(
      service,
      req.body,
      repo && hasDirectoryField
        ? { ...extractRepoPayload({ repo }), directory: directory || '' }
        : null
    );
    const result = await invokeWithOptions(service.installPlugin.bind(service), [installUrl, repoMetadata], options);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    res.json({
      success: true,
      platform,
      plugin: result.plugin,
      message: `Plugin "${result.plugin.name}" installed successfully`,
      ...(warning ? { warnings: [warning] } : {})
    });
  } catch (err) {
    console.error('[Plugins API] Install plugin error:', err);
    sendApiError(res, err);
  }
});

// ==================== 仓库管理 API ====================

/**
 * 获取插件仓库列表
 * GET /api/plugins/repos
 */
router.get('/repos', async (req, res) => {
  try {
    const { platform, service, warning } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const repos = invokeWithOptions(service.getRepos.bind(service), [], options);
    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos),
      ...((warning || service.getMigrationWarnings?.().length) ? {
        warnings: [
          ...(warning ? [warning] : []),
          ...(service.getMigrationWarnings?.() || [])
        ]
      } : {})
    });
  } catch (err) {
    console.error('[Plugins API] Get repos error:', err);
    sendApiError(res, err);
  }
});

/**
 * 添加插件仓库
 * POST /api/plugins/repos
 * Body: { url, name, description }
 */
router.post('/repos', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const repo = extractRepoPayload(req.body);
    repo.enabled = req.body.enabled !== false;

    if (!repo.source && !repo.localPath && !repo.projectPath && (!repo.owner || !repo.name) && !repo.repoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Missing repo info'
      });
    }

    const repos = invokeWithOptions(service.addRepo.bind(service), [repo], options);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos),
      message: 'Repository added successfully'
    });
  } catch (err) {
    console.error('[Plugins API] Add repo error:', err);
    sendApiError(res, err);
  }
});

router.delete('/repos', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const { id = '', owner = '', name = '' } = req.query;
    const repos = invokeWithOptions(service.removeRepo.bind(service), [owner, name, id], options);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Plugins API] Remove repo error:', err);
    sendApiError(res, err);
  }
});

router.put('/repos/toggle', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { id = '', owner = '', name = '', enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean'
      });
    }

    const repos = service.toggleRepo(owner, name, enabled, id);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Plugins API] Toggle repo error:', err);
    sendApiError(res, err);
  }
});

/**
 * 删除插件仓库
 * DELETE /api/plugins/repos/:owner/:name
 */
router.delete('/repos/:owner/:name', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { owner, name } = req.params;
    const { id = '' } = req.query;

    const repos = service.removeRepo(owner, name, id);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos),
      message: 'Repository removed successfully'
    });
  } catch (err) {
    console.error('[Plugins API] Remove repo error:', err);
    sendApiError(res, err);
  }
});

/**
 * 切换插件仓库启用状态
 * PUT /api/plugins/repos/:owner/:name/toggle
 * Body: { enabled }
 */
router.put('/repos/:owner/:name/toggle', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { owner, name } = req.params;
    const { enabled, id = '' } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean'
      });
    }

    const repos = service.toggleRepo(owner, name, enabled, id);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos),
      message: `Repository ${enabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('[Plugins API] Toggle repo error:', err);
    sendApiError(res, err);
  }
});

router.put('/repos/auth', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const {
      id = '',
      owner = '',
      name = '',
      token = '',
      clearToken = false
    } = req.body;

    if (!clearToken && !String(token || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Missing token'
      });
    }

    const repos = service.updateRepoAuth(owner, name, token, clearToken, id);

    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos)
    });
  } catch (err) {
    console.error('[Plugins API] Update repo auth error:', err);
    sendApiError(res, err);
  }
});

/**
 * Legacy alias for the explicit plugin refresh task.
 * POST /api/plugins/repos/sync
 */
router.post('/repos/sync', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const refreshTasks = getRefreshTasks();
    const task = refreshTasks.enqueue({
      platform,
      scope: options.scope || 'user',
      projectPath: options.scope === 'project' ? options.cwd : null,
      reason: 'manual'
    });

    res.status(202).json({
      success: true,
      platform,
      task,
      message: 'Plugin refresh task started'
    });
  } catch (err) {
    console.error('[Plugins API] Sync repos error:', err);
    sendApiError(res, err);
  }
});

/**
 * 同步本地插件列表
 * POST /api/plugins/sync
 */
router.post('/sync', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const options = await getRequestOptions(req, service);
    const result = await service.syncPlugins(options);

    res.json({
      success: true,
      platform,
      ...result,
      message: 'Plugins synced successfully'
    });
  } catch (err) {
    console.error('[Plugins API] Sync plugins error:', err);
    sendApiError(res, err);
  }
});

/**
 * 获取插件 README
 * GET /api/plugins/:name/readme
 * Query: repoOwner, repoName, repoBranch, directory, source, repoUrl
 */
router.get('/:name/readme', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;
    const options = await getRequestOptions(req, service);
    const {
      repoId,
      repoProvider,
      repoHost,
      repoOwner,
      repoName,
      repoBranch,
      directory,
      source,
      repoUrl,
      repoProjectPath,
      repoLocalPath,
      installPath,
      scope: queryScope,
      cwd: queryCwd
    } = req.query;

    const pluginInfo = {
      name,
      repoId,
      repoProvider,
      repoHost,
      repoOwner,
      repoName,
      repoBranch,
      directory,
      source,
      repoUrl,
      repoProjectPath,
      repoLocalPath,
      installPath
    };

    const readmeOptions = {
      ...(options.scope || queryScope ? { scope: options.scope || queryScope } : {}),
      ...(options.cwd || queryCwd ? { cwd: options.cwd || queryCwd } : {})
    };
    const readme = Object.keys(readmeOptions).length > 0
      ? await service.getPluginReadme(pluginInfo, readmeOptions)
      : await service.getPluginReadme(pluginInfo);

    res.json({
      success: true,
      platform,
      readme
    });
  } catch (err) {
    console.error('[Plugins API] Get plugin README error:', err);
    res.status(500).json({
      success: false,
      message: err.message,
      readme: ''
    });
  }
});

/**
 * 获取单个插件详情
 * GET /api/plugins/:name
 */
router.get('/:name', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;
    const options = await getRequestOptions(req, service);

    const plugin = service.getPlugin(req.query.pluginId || name, options);

    if (!plugin) {
      return res.status(404).json({
        success: false,
        message: `Plugin "${name}" not found`
      });
    }

    res.json({
      success: true,
      platform,
      plugin
    });
  } catch (err) {
    console.error('[Plugins API] Get plugin error:', err);
    sendApiError(res, err);
  }
});

/**
 * 卸载插件
 * DELETE /api/plugins/:name
 */
router.delete('/:name', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;
    const options = await getRequestOptions(req, service);
    const pluginId = req.query.pluginId || name;

    const result = service.uninstallPlugin(pluginId, options);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    res.json({
      success: true,
      platform,
      message: result.message
    });
  } catch (err) {
    console.error('[Plugins API] Uninstall plugin error:', err);
    sendApiError(res, err);
  }
});

/**
 * 切换插件启用状态
 * PUT /api/plugins/:name/toggle
 * Body: { enabled }
 */
router.put('/:name/toggle', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;
    const { enabled, pluginId = name } = req.body;
    const options = await getRequestOptions(req, service);

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean'
      });
    }

    const plugin = invokeWithOptions(service.togglePlugin.bind(service), [pluginId, enabled], options);

    res.json({
      success: true,
      platform,
      plugin,
      message: `Plugin "${name}" ${enabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('[Plugins API] Toggle plugin error:', err);
    sendApiError(res, err);
  }
});

/**
 * 更新插件配置
 * PUT /api/plugins/:name/config
 * Body: { config }
 */
router.put('/:name/config', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;
    const { config, pluginId = name } = req.body;
    const options = await getRequestOptions(req, service);

    if (!config || typeof config !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'config must be an object'
      });
    }

    const result = invokeWithOptions(service.updatePluginConfig.bind(service), [pluginId, config], options);

    res.json({
      success: true,
      platform,
      message: result.message
    });
  } catch (err) {
    console.error('[Plugins API] Update plugin config error:', err);
    sendApiError(res, err);
  }
});

module.exports = router;
