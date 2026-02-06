const express = require('express');
const router = express.Router();
const { getProjects, isOpenCodeInstalled } = require('../services/opencode-sessions');

module.exports = (config) => {
  /**
   * GET /api/opencode/projects
   * 获取所有 OpenCode 项目列表
   */
  router.get('/', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.json({
          projects: [],
          currentProject: null,
          error: 'OpenCode CLI not installed or not found'
        });
      }

      const projects = getProjects();

      res.json({
        projects,
        currentProject: projects[0] ? projects[0].name : null
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to get projects:', err);

      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: 'OpenCode data directory not found',
          projects: []
        });
      }

      res.status(500).json({
        error: err.message,
        projects: []
      });
    }
  });

  return router;
};
