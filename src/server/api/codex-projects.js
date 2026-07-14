const express = require('express');
const router = express.Router();
const { saveProjectOrder, deleteProject } = require('../services/codex-sessions');
const { isCodexInstalled } = require('../services/codex-config');
const {
  emptyProjectList,
  getProjectListSnapshot,
  invalidateProjectSnapshots
} = require('../services/project-snapshots');
const { invalidateSessionSnapshots } = require('../services/session-snapshots');
const { runDashboardSnapshotWorker } = require('../services/dashboard-snapshot-worker');

const DEBUG_CODEX_PERF = process.env.DEBUG_CODEX_PERF === '1';

function logPerf(route, startMs, detail = '') {
  if (!DEBUG_CODEX_PERF) return;
  const duration = Date.now() - startMs;
  const suffix = detail ? ` | ${detail}` : '';
  console.log(`[Codex Perf] ${route}: ${duration}ms${suffix}`);
}

module.exports = (config) => {
  /**
   * GET /api/codex/projects
   * 获取所有 Codex 项目列表
   */
  router.get('/', async (req, res) => {
    const startMs = Date.now();
    try {
      // 检查 Codex 是否安装
      if (!isCodexInstalled()) {
        logPerf('GET /api/codex/projects', startMs, 'codex not installed');
        return res.json({
          projects: [],
          currentProject: null,
          error: 'Codex CLI not installed or not found',
          meta: { generatedAt: new Date().toISOString(), stale: false, refreshing: false, fallback: true, error: null }
        });
      }

      const force = req.query?.fresh === '1';
      const snapshot = await getProjectListSnapshot('codex', {
        fallbackValue: emptyProjectList(null),
        force,
        refresh: () => runDashboardSnapshotWorker('projects', 'codex', config, { force })
      });
      logPerf('GET /api/codex/projects', startMs, `projects=${snapshot.value.projects.length} stale=${snapshot.meta.stale}`);

      res.json({ ...snapshot.value, meta: snapshot.meta });
    } catch (err) {
      console.error('[Codex API] Failed to get projects:', err);
      logPerf('GET /api/codex/projects', startMs, `error=${err.message}`);

      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Codex sessions directory not found',
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
   * POST /api/codex/projects/order
   * 保存项目排序
   */
  router.post('/order', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { order } = req.body;

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      saveProjectOrder(order);
      invalidateProjectSnapshots('codex');

      res.json({ success: true });
    } catch (err) {
      console.error('[Codex API] Failed to save project order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/codex/projects/:projectName
   * 删除项目（删除项目下所有会话）
   */
  router.delete('/:projectName', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { projectName } = req.params;
      const result = deleteProject(projectName);
      invalidateProjectSnapshots('codex');
      invalidateSessionSnapshots('codex', projectName);

      res.json(result);
    } catch (err) {
      console.error('[Codex API] Failed to delete project:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
