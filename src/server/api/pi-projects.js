const express = require('express');
const router = express.Router();
const {
  getProjects,
  saveProjectOrder,
  deleteProject,
  isPiInstalled
} = require('../services/pi-sessions');

function isNotFoundError(error) {
  return !!(error && error.message === 'Project not found');
}

module.exports = () => {
  router.get('/', (req, res) => {
    try {
      if (!isPiInstalled()) {
        return res.json({
          projects: [],
          currentProject: null,
          error: 'Pi CLI not installed or not found'
        });
      }

      const projects = getProjects();
      res.json({
        projects,
        currentProject: projects[0] ? projects[0].name : null
      });
    } catch (err) {
      console.error('[Pi API] Failed to get projects:', err);
      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Pi data directory not found',
          projects: []
        });
      }
      res.status(500).json({ error: err.message, projects: [] });
    }
  });

  router.post('/order', (req, res) => {
    try {
      if (!isPiInstalled()) {
        return res.status(404).json({ error: 'Pi CLI not installed' });
      }
      const { order } = req.body || {};
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }
      saveProjectOrder(order);
      res.json({ success: true });
    } catch (err) {
      console.error('[Pi API] Failed to save project order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:projectName', (req, res) => {
    try {
      if (!isPiInstalled()) {
        return res.status(404).json({ error: 'Pi CLI not installed' });
      }
      const result = deleteProject(req.params.projectName);
      res.json(result);
    } catch (err) {
      if (isNotFoundError(err)) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[Pi API] Failed to delete project:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
