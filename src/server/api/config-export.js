/**
 * 配置导出/导入 API 路由
 */

const express = require('express');
const configExportService = require('../services/config-export-service');

const router = express.Router();

/**
 * 导出所有配置
 * GET /api/config-export
 */
router.get('/', (req, res) => {
  try {
    const result = configExportService.exportAllConfigs();

    if (result.success) {
      // 设置响应头，触发文件下载
      const filename = `ctx-config-${new Date().toISOString().split('T')[0]}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(result.data);
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
router.post('/import', (req, res) => {
  try {
    const { data, overwrite = false } = req.body;

    if (!data) {
      return res.status(400).json({
        success: false,
        message: '缺少导入数据'
      });
    }

    const result = configExportService.importConfigs(data, { overwrite });

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

    const summary = {
      version: data.version,
      exportedAt: data.exportedAt,
      counts: {
        permissionTemplates: (data.data.permissionTemplates || []).length,
        configTemplates: (data.data.configTemplates || []).length,
        channels: (data.data.channels || []).length
      },
      items: {
        permissionTemplates: (data.data.permissionTemplates || []).map(t => ({
          id: t.id,
          name: t.name,
          description: t.description
        })),
        configTemplates: (data.data.configTemplates || []).map(t => ({
          id: t.id,
          name: t.name,
          description: t.description
        })),
        channels: (data.data.channels || []).map(c => ({
          id: c.id,
          name: c.name,
          type: c.type
        }))
      }
    };

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

module.exports = router;
