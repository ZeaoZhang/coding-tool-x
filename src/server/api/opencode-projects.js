const express = require('express');
const router = express.Router();
const {
  getProjects,
  saveProjectOrder,
  deleteProject,
  isOpenCodeInstalled
} = require('../services/opencode-sessions');

function isNotFoundError(error) {
  return !!(error && error.message === 'Project not found');
}

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

  /**
   * POST /api/opencode/projects/order
   * 保存项目排序
   */
  router.post('/order', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { order } = req.body;
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      saveProjectOrder(order);
      res.json({ success: true });
    } catch (err) {
      console.error('[OpenCode API] Failed to save project order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/opencode/projects/:projectName
   * 删除项目（删除项目下所有会话）
   */
  router.delete('/:projectName', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { projectName } = req.params;
      const result = deleteProject(projectName);
      res.json(result);
    } catch (err) {
      if (isNotFoundError(err)) {
        console.warn('[OpenCode API] Delete project target not found:', err.message);
        return res.status(404).json({ error: err.message });
      }
      console.error('[OpenCode API] Failed to delete project:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
