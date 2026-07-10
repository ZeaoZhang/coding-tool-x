/**
 * 配置导出/导入 API 路由
 */

const express = require('express');
const configExportService = require('../services/config-export-service');
const AdmZip = require('adm-zip');

const router = express.Router();

function parseConfigZip(buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('config.json');
  if (!entry) {
    throw new Error('配置包缺少 config.json');
  }
  const content = entry.getData().toString('utf8');
  return JSON.parse(content);
}

function resolveChannelsByType(exportData) {
  const raw = exportData?.data || {};
  const typed = raw.channelsByType && typeof raw.channelsByType === 'object' ? raw.channelsByType : {};
  return {
    claude: Array.isArray(typed.claude) ? typed.claude : (Array.isArray(raw.channels) ? raw.channels : []),
    codex: Array.isArray(typed.codex) ? typed.codex : [],
    gemini: Array.isArray(typed.gemini) ? typed.gemini : [],
    opencode: Array.isArray(typed.opencode) ? typed.opencode : [],
    omp: Array.isArray(typed.omp) ? typed.omp: []
  };
}

function buildPreviewSummary(data) {
  const channelsByType = resolveChannelsByType(data);
  const pluginsByPlatform = data?.data?.pluginsByPlatform && typeof data.data.pluginsByPlatform === 'object'
    ? data.data.pluginsByPlatform
    : {};
  const platformPlugins = Object.values(pluginsByPlatform).flatMap((snapshot) => (
    Array.isArray(snapshot?.plugins) ? snapshot.plugins : []
  ));
  const plugins = platformPlugins.length > 0
    ? platformPlugins
    : (Array.isArray(data.data.plugins) ? data.data.plugins : []);
  const allChannels = [
    ...channelsByType.claude.map(c => ({ ...c, type: c.type || 'claude' })),
    ...channelsByType.codex.map(c => ({ ...c, type: c.type || 'codex' })),
    ...channelsByType.gemini.map(c => ({ ...c, type: c.type || 'gemini' })),
    ...channelsByType.opencode.map(c => ({ ...c, type: c.type || 'opencode' })),
    ...channelsByType.omp.map(c => ({ ...c, type: c.type || 'omp' }))
  ];

  return {
    version: data.version,
    exportedAt: data.exportedAt,
    counts: {
      configTemplates: (data.data.configTemplates || []).length,
      channels: allChannels.length,
      plugins: plugins.length
    },
    items: {
      configTemplates: (data.data.configTemplates || []).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description
      })),
      channels: allChannels.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type
      })),
      plugins: plugins.map(p => ({
        name: p.name,
        type: p.type,
        platform: p.platform,
        version: p.version
      }))
    }
  };
}

/**
 * 导出所有配置
 * GET /api/config-export
 */
router.get('/', (req, res) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();
    const result = format === 'zip'
      ? configExportService.exportAllConfigsZip()
      : configExportService.exportAllConfigs();

    if (result.success) {
      if (format === 'zip') {
        // 设置响应头，触发文件下载
        const filename = result.filename || `ctx-config-${new Date().toISOString().split('T')[0]}.zip`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/zip');
        res.send(result.data);
      } else {
        // 设置响应头，触发文件下载
        const filename = `ctx-config-${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/json');
        res.json(result.data);
      }
    } else {
      res.status(500).json({
        success: false,
        message: result.message
      });
    }
  } catch (err) {
    console.error('[ConfigExport API] 导出失败:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 导入配置
 * POST /api/config-export/import
 * Body: { data: {...}, overwrite: boolean }
 */
router.post('/import', async (req, res) => {
  try {
    const { data, overwrite = false } = req.body;

    if (!data) {
      return res.status(400).json({
        success: false,
        message: '缺少导入数据'
      });
    }

    const result = await configExportService.importConfigs(data, { overwrite });

    res.json(result);
  } catch (err) {
    console.error('[ConfigExport API] 导入失败:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 导入 ZIP 配置
 * POST /api/config-export/import-zip
 */
router.post('/import-zip', express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '100mb' }), async (req, res) => {
  try {
    const overwrite = req.query.overwrite === 'true';
    const buffer = req.body;

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: '缺少 ZIP 文件内容'
      });
    }

    const data = parseConfigZip(buffer);
    const result = await configExportService.importConfigs(data, { overwrite });
    res.json(result);
  } catch (err) {
    console.error('[ConfigExport API] 导入 ZIP 失败:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 预览导入配置（不实际导入）
 * POST /api/config-export/preview
 */
router.post('/preview', (req, res) => {
  try {
    const { data } = req.body;

    if (!data || !data.data) {
      return res.status(400).json({
        success: false,
        message: '无效的导入数据格式'
      });
    }

    const summary = buildPreviewSummary(data);

    res.json({
      success: true,
      data: summary
    });
  } catch (err) {
    console.error('[ConfigExport API] 预览失败:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 预览 ZIP 导入配置（不实际导入）
 * POST /api/config-export/preview-zip
 */
router.post('/preview-zip', express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '100mb' }), (req, res) => {
  try {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: '缺少 ZIP 文件内容'
      });
    }

    const data = parseConfigZip(buffer);
    if (!data || !data.data) {
      return res.status(400).json({
        success: false,
        message: '无效的导入数据格式'
      });
    }

    const summary = buildPreviewSummary(data);
    res.json({
      success: true,
      data: summary
    });
  } catch (err) {
    console.error('[ConfigExport API] 预览 ZIP 失败:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
