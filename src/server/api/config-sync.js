/**
 * 配置同步 API 路由
 */

const express = require('express');
const { ConfigSyncService } = require('../../platforms/drivers/claude/config-sync');

const router = express.Router();
const configSyncService = new ConfigSyncService();

/**
 * 获取可同步的配置列表
 * GET /api/config-sync/available
 * Query: source=global|workspace, projectPath=...
 */
router.get('/available', (req, res) => {
    try {
        const { source = 'global', projectPath } = req.query;

        if (source === 'workspace' && !projectPath) {
            return res.status(400).json({
                success: false,
                message: '获取工作区配置需要指定 projectPath'
            });
        }

        const configs = configSyncService.getAvailableConfigs(source, projectPath);

        res.json({
            success: true,
            source,
            configs
        });
    } catch (err) {
        console.error('[ConfigSync API] Get available configs error:', err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

/**
 * 获取同步统计信息
 * GET /api/config-sync/stats
 * Query: projectPath=...
 */
router.get('/stats', (req, res) => {
    try {
        const { projectPath } = req.query;
        const stats = configSyncService.getStats(projectPath);

        res.json({
            success: true,
            stats
        });
    } catch (err) {
        console.error('[ConfigSync API] Get stats error:', err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

/**
 * 预览同步结果
 * POST /api/config-sync/preview
 * Body: { source, target, configTypes, projectPath, selectedItems }
 */
router.post('/preview', (req, res) => {
    try {
        const { source, target, configTypes, projectPath, selectedItems } = req.body;

        if (!source || !target) {
            return res.status(400).json({
                success: false,
                message: '请指定源和目标'
            });
        }

        if (!configTypes || configTypes.length === 0) {
            return res.status(400).json({
                success: false,
                message: '请选择要同步的配置类型'
            });
        }

        const preview = configSyncService.previewSync({
            source,
            target,
            configTypes,
            projectPath,
            selectedItems
        });

        res.json({
            success: true,
            preview
        });
    } catch (err) {
        console.error('[ConfigSync API] Preview sync error:', err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

/**
 * 执行同步
 * POST /api/config-sync/execute
 * Body: { source, target, configTypes, projectPath, selectedItems, overwrite }
 */
router.post('/execute', (req, res) => {
    try {
        const { source, target, configTypes, projectPath, selectedItems, overwrite = false } = req.body;

        if (!source || !target) {
            return res.status(400).json({
                success: false,
                message: '请指定源和目标'
            });
        }

        if (!configTypes || configTypes.length === 0) {
            return res.status(400).json({
                success: false,
                message: '请选择要同步的配置类型'
            });
        }

        const result = configSyncService.executeSync({
            source,
            target,
            configTypes,
            projectPath,
            selectedItems,
            overwrite
        });

        res.json({
            success: true,
            result
        });
    } catch (err) {
        console.error('[ConfigSync API] Execute sync error:', err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

module.exports = router;
