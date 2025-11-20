const express = require('express');
const router = express.Router();
const { getProjectsWithStats, saveProjectOrder, getProjectOrder, deleteProject } = require('../services/sessions');

module.exports = (config) => {
  // GET /api/projects - Get all projects with stats
  router.get('/', (req, res) => {
    try {
      const projects = getProjectsWithStats(config);
      const order = getProjectOrder(config);

      // Sort projects by saved order
      let sortedProjects = projects;
      if (order && order.length > 0) {
        const orderMap = new Map(order.map((name, idx) => [name, idx]));
        sortedProjects = [...projects].sort((a, b) => {
          const aIdx = orderMap.has(a.name) ? orderMap.get(a.name) : 999999;
          const bIdx = orderMap.has(b.name) ? orderMap.get(b.name) : 999999;
          if (aIdx === bIdx) {
            // Both are new, sort by lastUsed
            return (b.lastUsed || 0) - (a.lastUsed || 0);
          }
          return aIdx - bIdx;
        });
      }

      res.json({
        projects: sortedProjects,
        currentProject: config.currentProject || (sortedProjects[0] ? sortedProjects[0].name : null)
      });
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
      saveProjectOrder(config, order);
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving project order:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/projects/:projectName - Delete a project
  router.delete('/:projectName', (req, res) => {
    try {
      const { projectName } = req.params;
      deleteProject(config, projectName);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting project:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
