const express = require('express');
const router = express.Router();
const {
  getProjects,
  getSessionsByProject,
  getSessionById,
  getSessionMessages,
  getRecentSessions,
  searchSessions,
  deleteSession,
  forkSession,
  saveSessionOrder,
  isOpenCodeInstalled
} = require('../services/opencode-sessions');
const { loadAliases } = require('../services/alias');
const { broadcastLog } = require('../websocket-server');
const { HOME_DIR } = require('../../config/paths');

function isNotFoundError(error) {
  if (!error || !error.message) {
    return false;
  }
  return error.message === 'Session not found' || error.message === 'Project not found';
}

module.exports = (config) => {
  /**
   * GET /api/opencode/sessions/search/global?keyword=xxx
   * 全局搜索
   */
  router.get('/search/global', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { keyword } = req.query;
      const parsedContextLength = req.query.context ? parseInt(req.query.context, 10) : 35;
      const contextLength = Number.isFinite(parsedContextLength) ? parsedContextLength : 35;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const results = searchSessions(keyword, contextLength);
      const totalMatches = results.reduce((sum, session) => sum + (session.matchCount || 0), 0);

      res.json({
        keyword,
        totalMatches,
        sessions: results,
        source: 'opencode'
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to search sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/opencode/sessions/recent/list?limit=10
   * 获取最近会话
   */
  router.get('/recent/list', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const limit = parseInt(req.query.limit, 10) || 5;
      const sessions = getRecentSessions(limit);

      res.json({
        sessions,
        source: 'opencode'
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to get recent sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/opencode/sessions/:projectName/search
   * 项目内搜索
   */
  router.get('/:projectName/search', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { projectName } = req.params;
      const { keyword } = req.query;
      const parsedContextLength = req.query.context ? parseInt(req.query.context, 10) : 35;
      const contextLength = Number.isFinite(parsedContextLength) ? parsedContextLength : 35;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const results = searchSessions(keyword, contextLength, projectName);
      const totalMatches = results.reduce((sum, session) => sum + (session.matchCount || 0), 0);

      res.json({
        keyword,
        totalMatches,
        sessions: results
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to search project sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/opencode/sessions/:projectName
   * 获取项目的所有会话
   */
  router.get('/:projectName', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { projectName } = req.params;
      const sessions = getSessionsByProject(projectName);
      const aliases = loadAliases();
      const projects = getProjects();
      const project = projects.find(p => p.name === projectName);

      // 计算总大小
      const totalSize = sessions.reduce((sum, session) => {
        return sum + (session.size || 0);
      }, 0);

      res.json({
        sessions,
        totalSize,
        aliases,
        projectInfo: {
          name: projectName,
          fullPath: project?.fullPath || projectName,
          path: project?.path || projectName,
          displayName: project?.displayName || projectName
        }
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to get sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/opencode/sessions/:projectName/:sessionId/messages
   * 获取会话的消息列表
   */
  router.get('/:projectName/:sessionId/messages', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { sessionId } = req.params;
      const { page = 1, limit = 20, order = 'desc' } = req.query;
      const session = getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const convertedMessages = getSessionMessages(sessionId);

      // 分页处理
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      let messages = convertedMessages;
      if (order === 'desc') {
        messages = [...messages].reverse();
      }

      const totalMessages = messages.length;
      const start = (pageNum - 1) * limitNum;
      const end = start + limitNum;
      const paginatedMessages = messages.slice(start, end);

      res.json({
        messages: paginatedMessages,
        metadata: {
          gitBranch: null,
          gitRepository: null,
          cwd: session?.directory || null,
          model: 'opencode'
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalMessages,
          hasMore: end < totalMessages
        }
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to get session messages:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/opencode/sessions/:projectName/:sessionId
   * 删除会话
   */
  router.delete('/:projectName/:sessionId', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { sessionId } = req.params;
      const result = deleteSession(sessionId);

      res.json(result);
    } catch (err) {
      if (isNotFoundError(err)) {
        console.warn('[OpenCode API] Delete session target not found:', err.message);
        return res.status(404).json({ error: err.message });
      }
      console.error('[OpenCode API] Failed to delete session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/opencode/sessions/:projectName/batch-delete
   * 批量删除会话
   */
  router.post('/:projectName/batch-delete', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { sessionIds } = req.body || {};
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return res.status(400).json({ error: 'sessionIds must be a non-empty array' });
      }

      const uniqueSessionIds = Array.from(new Set(
        sessionIds
          .filter(sessionId => typeof sessionId === 'string')
          .map(sessionId => sessionId.trim())
          .filter(Boolean)
      ));

      if (uniqueSessionIds.length === 0) {
        return res.status(400).json({ error: 'sessionIds must be a non-empty array' });
      }

      const deletedSessionIds = [];
      const failed = [];

      uniqueSessionIds.forEach((sessionId) => {
        try {
          deleteSession(sessionId);
          deletedSessionIds.push(sessionId);
        } catch (err) {
          failed.push({
            sessionId,
            error: err.message
          });
        }
      });

      res.json({
        success: failed.length === 0,
        requestedCount: uniqueSessionIds.length,
        deletedCount: deletedSessionIds.length,
        deletedSessionIds,
        failed
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to batch delete sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/opencode/sessions/:projectName/:sessionId/fork
   * Fork 一个会话
   */
  router.post('/:projectName/:sessionId/fork', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { sessionId } = req.params;
      const result = forkSession(sessionId);
      res.json(result);
    } catch (err) {
      if (isNotFoundError(err)) {
        console.warn('[OpenCode API] Fork session target not found:', err.message);
        return res.status(404).json({ error: err.message });
      }
      console.error('[OpenCode API] Failed to fork session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/opencode/sessions/:projectName/order
   * 保存会话排序
   */
  router.post('/:projectName/order', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { projectName } = req.params;
      const { order } = req.body;

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      saveSessionOrder(projectName, order);
      res.json({ success: true });
    } catch (err) {
      console.error('[OpenCode API] Failed to save session order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/opencode/sessions/:projectName/:sessionId/launch
   * 获取会话启动命令（用于复制）
   */
  router.post('/:projectName/:sessionId/launch', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { projectName, sessionId } = req.params;

      const session = getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const projects = getProjects();
      const project = projects.find(p => p.name === projectName);
      const cwd = session.directory || project?.fullPath || HOME_DIR;
      const command = `opencode -r ${sessionId}`;
      const quotedCwd = `"${String(cwd).replace(/"/g, '\\"')}"`;
      const copyCommand = `cd ${quotedCwd} && ${command}`;

      broadcastLog({
        type: 'action',
        action: 'launch_opencode_session',
        message: `复制 OpenCode 会话启动命令 ${sessionId.substring(0, 8)}`,
        sessionId,
        tool: 'opencode',
        timestamp: Date.now()
      });

      res.json({
        success: true,
        cwd,
        sessionId,
        tool: 'opencode',
        command,
        copyCommand
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to prepare launch command:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
