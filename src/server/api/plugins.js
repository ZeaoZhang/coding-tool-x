/**
 * Plugins API 路由
 *
 * 管理 CTX 插件系统
 */

const express = require('express');
const { PluginsService } = require('../services/plugins-service');
const { maskToken } = require('../services/oauth-utils');
const { sendApiError } = require('./validation-errors');

const router = express.Router();
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
const pluginServices = new Map();

function resolvePlatform(rawPlatform) {
  return SUPPORTED_PLATFORMS.includes(rawPlatform) ? rawPlatform : 'claude';
}

function getPlatform(req) {
  return resolvePlatform(req.query?.platform || req.body?.platform);
}

function getPluginsService(req) {
  const platform = getPlatform(req);
  if (!pluginServices.has(platform)) {
    pluginServices.set(platform, new PluginsService(platform));
  }
  return { platform, service: pluginServices.get(platform) };
}

function extractRepoPayload(source = {}) {
  const repo = source.repo && typeof source.repo === 'object' ? source.repo : source;
  return {
    id: repo.id || source.repoId || '',
    provider: repo.provider || source.provider || '',
    host: repo.host || source.host || '',
    owner: repo.owner || source.owner || '',
    name: repo.name || source.name || '',
    branch: repo.branch || source.branch || 'main',
    directory: repo.directory || source.directory || '',
    projectPath: repo.projectPath || source.projectPath || '',
    localPath: repo.localPath || source.localPath || '',
    repoUrl: repo.repoUrl || repo.url || source.repoUrl || source.url || '',
    token: repo.token || source.token || '',
    marketplace: repo.marketplace || source.marketplace || ''
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
router.get('/', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const result = service.listPlugins();

    res.json({
      success: true,
      platform,
      ...result
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
    const { platform, service } = getPluginsService(req);
    const forceRefresh = req.query.refresh === '1';
    if (forceRefresh) {
      console.log(`[Plugins API] Refreshing market plugins for ${platform}...`);
    }
    const plugins = await service.getMarketPlugins(forceRefresh);
    console.log(`[Plugins API] ${platform}: ${plugins.length} market plugins loaded (refresh=${forceRefresh})`);

    res.json({
      success: true,
      platform,
      plugins
    });
  } catch (err) {
    console.error('[Plugins API] Get market plugins error:', err);
    sendApiError(res, err);
  }
});

/**
 * 安装插件
 * POST /api/plugins/install
 * Body: { directory, repo: { owner, name, branch } } or { source }
 */
router.post('/install', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { directory, repo, gitUrl, source } = req.body;
    const hasDirectoryField = Object.prototype.hasOwnProperty.call(req.body, 'directory');

    // Support both new format (directory + repo) and legacy format (gitUrl)
    let installUrl;
    if (source) {
      installUrl = source;
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

    const result = await service.installPlugin(
      installUrl,
      repo && hasDirectoryField
        ? {
            ...extractRepoPayload({ repo }),
            directory: directory || ''
          }
        : null
    );

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
      message: `Plugin "${result.plugin.name}" installed successfully`
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
router.get('/repos', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const repos = service.getRepos();
    res.json({
      success: true,
      platform,
      repos: sanitizeRepos(service, repos)
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
router.post('/repos', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const repo = extractRepoPayload(req.body);
    repo.enabled = req.body.enabled !== false;

    if (!repo.localPath && !repo.projectPath && (!repo.owner || !repo.name) && !repo.repoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Missing repo info'
      });
    }

    const repos = service.addRepo(repo);

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

router.delete('/repos', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { id = '', owner = '', name = '' } = req.query;
    const repos = service.removeRepo(owner, name, id);

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
 * 同步仓库到 Claude Code marketplace
 * POST /api/plugins/repos/sync
 */
router.post('/repos/sync', async (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const result = await service.syncRepos();

    res.json({
      success: true,
      platform,
      ...result,
      message: 'Repositories synced successfully'
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
    const result = await service.syncPlugins();

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
      installPath
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

    const readme = await service.getPluginReadme(pluginInfo);

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
router.get('/:name', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;

    const plugin = service.getPlugin(name);

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
router.delete('/:name', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;

    const result = service.uninstallPlugin(name);

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
router.put('/:name/toggle', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean'
      });
    }

    const plugin = service.togglePlugin(name, enabled);

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
router.put('/:name/config', (req, res) => {
  try {
    const { platform, service } = getPluginsService(req);
    const { name } = req.params;
    const { config } = req.body;

    if (!config || typeof config !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'config must be an object'
      });
    }

    const result = service.updatePluginConfig(name, config);

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
