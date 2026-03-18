/**
 * Plugins API 路由
 *
 * 管理 CTX 插件系统
 */

const express = require('express');
const { PluginsService } = require('../services/plugins-service');

const router = express.Router();
const SUPPORTED_PLATFORMS = ['claude', 'opencode'];
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
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    res.status(500).json({
      success: false,
      message: err.message
    });
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

    // Support both new format (directory + repo) and legacy format (gitUrl)
    let installUrl;
    if (source) {
      installUrl = source;
    } else if (directory && repo) {
      installUrl = `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch || 'main'}/${directory}`;
    } else if (gitUrl) {
      installUrl = gitUrl;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Either source, (directory + repo), or gitUrl is required'
      });
    }

    const result = await service.installPlugin(installUrl);

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
    res.status(500).json({
      success: false,
      message: err.message
    });
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
      repos
    });
  } catch (err) {
    console.error('[Plugins API] Get repos error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    const repo = req.body;

    if (!repo || !repo.url) {
      return res.status(400).json({
        success: false,
        message: 'Repository URL is required'
      });
    }

    const repos = service.addRepo(repo);

    res.json({
      success: true,
      platform,
      repos,
      message: 'Repository added successfully'
    });
  } catch (err) {
    console.error('[Plugins API] Add repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
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

    const repos = service.removeRepo(owner, name);

    res.json({
      success: true,
      platform,
      repos,
      message: 'Repository removed successfully'
    });
  } catch (err) {
    console.error('[Plugins API] Remove repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean'
      });
    }

    const repos = service.toggleRepo(owner, name, enabled);

    res.json({
      success: true,
      platform,
      repos,
      message: `Repository ${enabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (err) {
    console.error('[Plugins API] Toggle repo error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    const { repoOwner, repoName, repoBranch, directory, source, repoUrl } = req.query;

    const pluginInfo = {
      name,
      repoOwner,
      repoName,
      repoBranch,
      directory,
      source,
      repoUrl
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
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    res.status(500).json({
      success: false,
      message: err.message
    });
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
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
