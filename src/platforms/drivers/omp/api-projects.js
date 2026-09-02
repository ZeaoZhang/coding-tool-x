const express = require('express');
const router = express.Router();
const {
  saveProjectOrder,
  deleteProject,
  isOmpInstalled
} = require('./sessions-implementation');
const {
  emptyProjectList,
  getProjectListSnapshot,
  invalidateProjectSnapshots
} = require('../../../server/services/project-snapshots');
const { invalidateSessionSnapshots } = require('../../../server/services/session-snapshots');
const { runDashboardSnapshotWorker } = require('../../../server/services/dashboard-snapshot-worker');

function isNotFoundError(error) {
  return !!(error && error.message === 'Project not found');
}

module.exports = () => {
  router.get('/', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.json({
          projects: [],
          currentProject: null,
          error: 'OMP CLI not installed or not found',
          meta: { generatedAt: new Date().toISOString(), stale: false, refreshing: false, fallback: true, error: null }
        });
      }

      const force = req.query?.fresh === '1';
      const snapshot = await getProjectListSnapshot('omp', {
        fallbackValue: emptyProjectList(null),
        force,
        refresh: () => runDashboardSnapshotWorker('projects', 'omp', {}, { force })
      });
      res.json({ ...snapshot.value, meta: snapshot.meta });
    } catch (err) {
      console.error('[OMP API] Failed to get projects:', err);
      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: 'OMP data directory not found',
          projects: []
        });
      }
      res.status(500).json({ error: err.message, projects: [] });
    }
  });

  router.post('/order', (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const { order } = req.body || {};
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }
      saveProjectOrder(order);
      invalidateProjectSnapshots('omp');
      res.json({ success: true });
    } catch (err) {
      console.error('[OMP API] Failed to save project order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:projectName', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const result = await deleteProject(req.params.projectName);
      invalidateProjectSnapshots('omp');
      invalidateSessionSnapshots('omp', req.params.projectName);
      res.json(result);
    } catch (err) {
      if (isNotFoundError(err)) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[OMP API] Failed to delete project:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
