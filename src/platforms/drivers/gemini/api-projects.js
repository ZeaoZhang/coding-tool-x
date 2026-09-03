const express = require('express');
const router = express.Router();
const { invokeProjectDriver } = require('../../../server/api/project-driver');
const {
  emptyProjectList,
  getProjectListSnapshot,
  invalidateProjectSnapshots
} = require('../../../server/services/project-snapshots');
const { invalidateSessionSnapshots } = require('../../../server/services/session-snapshots');
const { runDashboardSnapshotWorker } = require('../../../server/services/dashboard-snapshot-worker');

module.exports = (config) => {
  /**
   * GET /api/gemini/projects
   * 获取所有 Gemini 项目列表
   */
  router.get('/', async (req, res) => {
    try {
      if (!invokeProjectDriver('gemini', 'isAvailable')) {
        return res.json({
          projects: [],
          currentProject: null,
          error: 'Gemini CLI not installed or not found',
          meta: { generatedAt: new Date().toISOString(), stale: false, refreshing: false, fallback: true, error: null }
        });
      }

      const force = req.query?.fresh === '1';
      const snapshot = await getProjectListSnapshot('gemini', {
        fallbackValue: emptyProjectList(null),
        force,
        refresh: () => runDashboardSnapshotWorker('projects', 'gemini', config, { force })
      });
      res.json({ ...snapshot.value, meta: snapshot.meta });
    } catch (err) {
      console.error('[Gemini API] Failed to get projects:', err);

      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Gemini tmp directory not found',
          projects: []
        });
      }

      res.status(500).json({
        error: err.message,
        projects: []
      });
    }
  });

  /**
   * POST /api/gemini/projects/order
   * 保存项目排序
   */
  router.post('/order', (req, res) => {
    try {
      if (!invokeProjectDriver('gemini', 'isAvailable')) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { order } = req.body;

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      invokeProjectDriver('gemini', 'saveProjectOrder', [order]);
      invalidateProjectSnapshots('gemini');

      res.json({ success: true });
    } catch (err) {
      console.error('[Gemini API] Failed to save project order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/gemini/projects/:projectHash
   * 删除项目（删除项目下所有会话）
   */
  router.delete('/:projectHash', (req, res) => {
    try {
      if (!invokeProjectDriver('gemini', 'isAvailable')) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { projectHash } = req.params;
      const result = invokeProjectDriver('gemini', 'deleteProject', [projectHash]);
      invalidateProjectSnapshots('gemini');
      invalidateSessionSnapshots('gemini', projectHash);

      res.json(result);
    } catch (err) {
      console.error('[Gemini API] Failed to delete project:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
