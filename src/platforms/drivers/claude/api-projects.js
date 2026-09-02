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
  // GET /api/projects - Get all projects with stats
  router.get('/', async (req, res) => {
    try {
      const force = req.query?.fresh === '1';
      const snapshot = await getProjectListSnapshot('claude', {
        fallbackValue: emptyProjectList(config.currentProject || null),
        force,
        refresh: () => runDashboardSnapshotWorker('projects', 'claude', config, { force })
      });
      res.json({ ...snapshot.value, meta: snapshot.meta });
    } catch (error) {
      console.error('Error fetching projects:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/projects/order - Save project order
  router.post('/order', (req, res) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'Order must be an array' });
      }
      invokeProjectDriver('claude', 'saveProjectOrder', [order, { config }]);
      invalidateProjectSnapshots('claude');
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving project order:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/projects/create - Create a new project
  router.post('/create', (req, res) => {
    try {
      const { projectName, projectPath } = req.body;
      const result = invokeProjectDriver('claude', 'createProject', [{ projectName, projectPath }]);
      invalidateProjectSnapshots('claude');
      res.json(result);
    } catch (error) {
      console.error('Error creating project:', error);
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      res.status(status).json({ error: error.message });
    }
  });

  // DELETE /api/projects/:projectName - Delete a project
  router.delete('/:projectName', (req, res) => {
    try {
      const { projectName } = req.params;
      invokeProjectDriver('claude', 'deleteProject', [projectName, { config }]);
      invalidateProjectSnapshots('claude');
      invalidateSessionSnapshots('claude', projectName);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting project:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
