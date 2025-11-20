const express = require('express');
const router = express.Router();
const { getSessionsForProject, deleteSession, forkSession, saveSessionOrder, parseRealProjectPath, searchSessions, getRecentSessions, searchSessionsAcrossProjects } = require('../services/sessions');
const { loadAliases } = require('../services/alias');
const { broadcastLog } = require('../websocket-server');

module.exports = (config) => {
  // GET /api/sessions/search/global - Search sessions across all projects
  router.get('/search/global', (req, res) => {
    try {
      const { keyword, context } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const contextLength = context ? parseInt(context) : 35;
      const results = searchSessionsAcrossProjects(config, keyword, contextLength);

      res.json({
        keyword,
        totalMatches: results.reduce((sum, r) => sum + r.matchCount, 0),
        sessions: results
      });
    } catch (error) {
      console.error('Error searching sessions globally:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/recent - Get recent sessions across all projects
  router.get('/recent/list', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 5;
      const sessions = getRecentSessions(config, limit);
      res.json({ sessions });
    } catch (error) {
      console.error('Error fetching recent sessions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/:projectName - Get sessions for a project
  router.get('/:projectName', (req, res) => {
    try {
      const { projectName } = req.params;
      const result = getSessionsForProject(config, projectName);
      const aliases = loadAliases();

      // Parse project path info
      const { fullPath, projectName: displayName } = parseRealProjectPath(projectName);

      res.json({
        sessions: result.sessions,
        totalSize: result.totalSize,
        aliases,
        projectInfo: {
          name: projectName,
          displayName,
          fullPath
        }
      });
    } catch (error) {
      console.error('Error fetching sessions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/sessions/:projectName/:sessionId - Delete a session
  router.delete('/:projectName/:sessionId', (req, res) => {
    try {
      const { projectName, sessionId } = req.params;
      const result = deleteSession(config, projectName, sessionId);
      res.json(result);
    } catch (error) {
      console.error('Error deleting session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/sessions/:projectName/:sessionId/fork - Fork a session
  router.post('/:projectName/:sessionId/fork', (req, res) => {
    try {
      const { projectName, sessionId } = req.params;
      const result = forkSession(config, projectName, sessionId);
      res.json(result);
    } catch (error) {
      console.error('Error forking session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/sessions/:projectName/order - Save session order
  router.post('/:projectName/order', (req, res) => {
    try {
      const { projectName } = req.params;
      const { order } = req.body;
      saveSessionOrder(projectName, order);
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving session order:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/:projectName/search - Search sessions content
  router.get('/:projectName/search', (req, res) => {
    try {
      const { projectName } = req.params;
      const { keyword, context } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const contextLength = context ? parseInt(context) : 15;
      const results = searchSessions(config, projectName, keyword, contextLength);

      res.json({
        keyword,
        totalMatches: results.reduce((sum, r) => sum + r.matchCount, 0),
        sessions: results
      });
    } catch (error) {
      console.error('Error searching sessions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/sessions/:projectName/:sessionId/launch - Launch terminal with session
  router.post('/:projectName/:sessionId/launch', (req, res) => {
    try {
      const { projectName, sessionId } = req.params;
      const { execSync } = require('child_process');
      const path = require('path');
      const fs = require('fs');

      // Get session file path
      const sessionFile = path.join(config.projectsDir, projectName, sessionId + '.jsonl');
      if (!fs.existsSync(sessionFile)) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Extract working directory from session file
      let cwd = process.cwd();
      try {
        const content = fs.readFileSync(sessionFile, 'utf8');
        const firstLine = content.split('\n')[0];
        if (firstLine) {
          const json = JSON.parse(firstLine);
          if (json.cwd) {
            cwd = json.cwd;
          }
        }
      } catch (e) {
        // Use current directory if unable to extract
      }

      // Get alias
      const aliases = loadAliases();
      const alias = aliases[sessionId];

      // 广播行为日志
      broadcastLog({
        type: 'action',
        action: 'launch_session',
        message: `启动会话 ${alias || sessionId.substring(0, 8)}`,
        sessionId: sessionId,
        alias: alias || null,
        timestamp: Date.now()
      });

      // Launch Terminal.app on macOS
      const script = `
        tell application "Terminal"
          activate
          do script "cd '${cwd}' && claude -r ${sessionId}"
        end tell
      `;

      execSync(`osascript -e '${script}'`, { encoding: 'utf8' });

      res.json({ success: true, cwd });
    } catch (error) {
      console.error('Error launching terminal:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
