/**
 * Plugins API 路由
 *
 * 管理 CTX 插件系统
 */

const express = require('express');
const { PluginsService } = require('../services/plugins-service');

const router = express.Router();
const pluginsService = new PluginsService();

/**
 * 获取插件列表
 * GET /api/plugins
 */
router.get('/', (req, res) => {
  try {
    const result = pluginsService.listPlugins();

    res.json({
      success: true,
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
 * 安装插件
 * POST /api/plugins/install
 * Body: { gitUrl }
 */
router.post('/install', async (req, res) => {
  try {
    const { gitUrl } = req.body;

    if (!gitUrl) {
      return res.status(400).json({
        success: false,
        message: 'Git URL is required'
      });
    }

    const result = await pluginsService.installPlugin(gitUrl);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    res.json({
      success: true,
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
    const repos = pluginsService.getRepos();
    res.json({
      success: true,
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
    const repo = req.body;

    if (!repo || !repo.url) {
      return res.status(400).json({
        success: false,
        message: 'Repository URL is required'
      });
    }

    const repos = pluginsService.addRepo(repo);

    res.json({
      success: true,
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
 * DELETE /api/plugins/repos/:id
 */
router.delete('/repos/:id', (req, res) => {
  try {
    const { id } = req.params;

    const repos = pluginsService.removeRepo(id);

    res.json({
      success: true,
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
 * 获取单个插件详情
 * GET /api/plugins/:name
 */
router.get('/:name', (req, res) => {
  try {
    const { name } = req.params;

    const plugin = pluginsService.getPlugin(name);

    if (!plugin) {
      return res.status(404).json({
        success: false,
        message: `Plugin "${name}" not found`
      });
    }

    res.json({
      success: true,
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
    const { name } = req.params;

    const result = pluginsService.uninstallPlugin(name);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    res.json({
      success: true,
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
    const { name } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean'
      });
    }

    const plugin = pluginsService.togglePlugin(name, enabled);

    res.json({
      success: true,
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
    const { name } = req.params;
    const { config } = req.body;

    if (!config || typeof config !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'config must be an object'
      });
    }

    const result = pluginsService.updatePluginConfig(name, config);

    res.json({
      success: true,
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
