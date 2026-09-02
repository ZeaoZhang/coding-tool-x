const express = require('express');
const router = express.Router();
const { healthCheckAllProjects } = require('./health-check');
const { getProjects } = require('./sessions-implementation');

module.exports = (config) => {
  /**
   * GET /api/health-check - 健康检查所有项目
   */
  router.get('/', async (req, res) => {
    try {
      const projects = await getProjects(config);
      const projectList = Array.isArray(projects) ? projects : [];
      const result = healthCheckAllProjects(projectList);

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        ...result
      });
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};
