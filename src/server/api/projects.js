const express = require('express');
const router = express.Router();
const { getProjectsWithStats, saveProjectOrder, getProjectOrder, deleteProject } = require('../services/sessions');

module.exports = (config) => {
  // GET /api/projects - Get all projects with stats
  router.get('/', async (req, res) => {
    try {
      const projects = await getProjectsWithStats(config);
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

  // POST /api/projects/create - Create a new project
  router.post('/create', (req, res) => {
    try {
      const { projectName, projectPath } = req.body;
      const path = require('path');
      const fs = require('fs');

      if (!projectName || !projectPath) {
        return res.status(400).json({ error: 'projectName and projectPath are required' });
      }

      // 验证项目路径存在
      if (!fs.existsSync(projectPath)) {
        return res.status(400).json({ error: '项目路径不存在' });
      }

      // 验证是否为目录
      const stats = fs.statSync(projectPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: '项目路径必须是一个目录' });
      }

      // 在项目路径下创建 .claude 目录（与 Claude Code 默认行为一致）
      const claudeDir = path.join(projectPath, '.claude');
      const sessionsDir = path.join(claudeDir, 'sessions');

      // 检查是否已经初始化过
      if (fs.existsSync(claudeDir)) {
        return res.status(400).json({ error: '该项目已经初始化过 Claude Code' });
      }

      // 创建目录结构
      fs.mkdirSync(sessionsDir, { recursive: true });

      // 创建 .claude/project.json 配置文件（可选，记录元数据）
      const projectConfig = {
        name: projectName,
        createdAt: new Date().toISOString(),
        version: '1.0'
      };

      fs.writeFileSync(
        path.join(claudeDir, 'project.json'),
        JSON.stringify(projectConfig, null, 2),
        'utf8'
      );

      res.json({
        success: true,
        projectName,
        projectPath,
        claudeDir
      });
    } catch (error) {
      console.error('Error creating project:', error);
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
