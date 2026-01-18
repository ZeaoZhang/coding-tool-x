const express = require('express');
const router = express.Router();
const { healthCheckAllProjects } = require('../services/health-check');
const { getProjects } = require('../services/sessions');

module.exports = (config) => {
  /**
   * GET /api/health-check - 健康检查所有项目
   */
  router.get('/', (req, res) => {
    try {
      const projects = getProjects(config);
      const result = healthCheckAllProjects(projects);

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
