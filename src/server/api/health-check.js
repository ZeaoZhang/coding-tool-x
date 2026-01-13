const express = require('express');
const router = express.Router();
const {
  healthCheckAllProjects,
  scanLegacySessionFiles,
  migrateSessionFiles,
  cleanLegacySessionFiles
} = require('../services/health-check');
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

  /**
   * GET /api/health-check/scan-legacy - 扫描旧文件
   */
  router.get('/scan-legacy', (req, res) => {
    try {
      const result = scanLegacySessionFiles();

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        ...result
      });
    } catch (error) {
      console.error('Legacy scan failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/health-check/migrate-legacy - 迁移旧文件到正确位置
   * Body:
   * {
   *   "dryRun": boolean,  // 是否只是预演
   *   "projectNames": string[]  // 可选：指定要迁移的项目
   * }
   */
  router.post('/migrate-legacy', (req, res) => {
    try {
      const { dryRun = false, projectNames = null } = req.body;

      const result = migrateSessionFiles({
        dryRun,
        projectNames
      });

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        ...result
      });
    } catch (error) {
      console.error('Legacy migration failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/health-check/clean-legacy - 清理旧文件
   * Body:
   * {
   *   "dryRun": boolean,  // 是否只是预演
   *   "projectNames": string[]  // 可选：指定要清理的项目
   * }
   */
  router.post('/clean-legacy', (req, res) => {
    try {
      const { dryRun = false, projectNames = null } = req.body;

      const result = cleanLegacySessionFiles({
        dryRun,
        projectNames
      });

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        ...result
      });
    } catch (error) {
      console.error('Legacy cleanup failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};
