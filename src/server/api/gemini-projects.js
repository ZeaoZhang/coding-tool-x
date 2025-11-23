const express = require('express');
const router = express.Router();
const { getProjects, saveProjectOrder, deleteProject } = require('../services/gemini-sessions');
const { isGeminiInstalled } = require('../services/gemini-config');

module.exports = (config) => {
  /**
   * GET /api/gemini/projects
   * 获取所有 Gemini 项目列表
   */
  router.get('/', (req, res) => {
    try {
      // 检查 Gemini 是否安装
      if (!isGeminiInstalled()) {
        return res.json({
          projects: [],
          currentProject: null,
          error: 'Gemini CLI not installed or not found'
        });
      }

      const projects = getProjects();

      res.json({
        projects,
        currentProject: projects[0] ? projects[0].name : null
      });
    } catch (err) {
      console.error('[Gemini API] Failed to get projects:', err);

      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Gemini tmp directory not found',
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
   * POST /api/gemini/projects/order
   * 保存项目排序
   */
  router.post('/order', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { order } = req.body;

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      saveProjectOrder(order);

      res.json({ success: true });
    } catch (err) {
      console.error('[Gemini API] Failed to save project order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/gemini/projects/:projectHash
   * 删除项目（删除项目下所有会话）
   */
  router.delete('/:projectHash', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { projectHash } = req.params;
      const result = deleteProject(projectHash);

      res.json(result);
    } catch (err) {
      console.error('[Gemini API] Failed to delete project:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
