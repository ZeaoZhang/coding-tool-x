const express = require('express');
const router = express.Router();
const {
  getProjects,
  getSessionsByProject,
  getSessionById,
  getRecentSessions,
  searchSessions,
  deleteSession,
  forkSession,
  saveSessionOrder,
  isOpenCodeInstalled
} = require('../services/opencode-sessions');
const { loadAliases } = require('../services/alias');
const { getTerminalLaunchCommand } = require('../services/terminal-config');
const { broadcastLog } = require('../websocket-server');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
   * Note: OpenCode 的消息存储在单独的 message 目录，暂时返回基本信息
   */
  router.get('/:projectName/:sessionId/messages', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { sessionId } = req.params;
      const { page = 1, limit = 20, order = 'desc' } = req.query;
      const session = getSessionById(sessionId);

      // 读取消息文件
      const messagesDir = path.join(
        os.homedir(), '.local', 'share', 'opencode', 'storage', 'message', sessionId
      );

      const convertedMessages = [];

      if (fs.existsSync(messagesDir)) {
        const files = fs.readdirSync(messagesDir)
          .filter(f => f.endsWith('.json'))
          .sort();

        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(messagesDir, file), 'utf8');
            const msg = JSON.parse(content);

            if (msg.role === 'user') {
              // 提取用户消息内容
              let textContent = '';
              if (Array.isArray(msg.content)) {
                textContent = msg.content
                  .filter(c => c.type === 'text')
                  .map(c => c.text || '')
                  .join('\n');
              } else if (typeof msg.content === 'string') {
                textContent = msg.content;
              }

              convertedMessages.push({
                type: 'user',
                content: textContent || '[空消息]',
                timestamp: msg.time?.created ? new Date(msg.time.created).toISOString() : null,
                model: null
              });
            } else if (msg.role === 'assistant') {
              // 提取助手消息内容
              let textContent = '';
              if (Array.isArray(msg.content)) {
                textContent = msg.content
                  .filter(c => c.type === 'text')
                  .map(c => c.text || '')
                  .join('\n');
              } else if (typeof msg.content === 'string') {
                textContent = msg.content;
              }

              convertedMessages.push({
                type: 'assistant',
                content: textContent || '[空消息]',
                timestamp: msg.time?.created ? new Date(msg.time.created).toISOString() : null,
                model: msg.model || 'opencode'
              });
            }
          } catch (parseErr) {
            // 忽略解析错误
          }
        }
      }

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
   * 启动会话（打开终端）
   */
  router.post('/:projectName/:sessionId/launch', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const { exec } = require('child_process');
      const { projectName, sessionId } = req.params;
      const { targetTool } = req.body || {};

      if (targetTool && targetTool !== 'opencode') {
        return res.status(400).json({
          error: 'OpenCode 会话暂不支持直接切换到其他 CLI，请使用 OpenCode 启动'
        });
      }

      const session = getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const projects = getProjects();
      const project = projects.find(p => p.name === projectName);
      const cwd = session.directory || project?.fullPath || os.homedir();
      const normalizedCwd = process.platform === 'win32' ? cwd.replace(/\//g, '\\') : cwd;

      const { command, terminalId, terminalName } = getTerminalLaunchCommand(
        normalizedCwd,
        sessionId,
        'opencode'
      );

      broadcastLog({
        type: 'action',
        action: 'launch_opencode_session',
        message: `启动 OpenCode 会话 ${sessionId.substring(0, 8)}`,
        sessionId,
        tool: 'opencode',
        timestamp: Date.now()
      });

      const shellOption = process.platform === 'win32' ? { shell: 'cmd.exe' } : { shell: true };
      exec(command, shellOption, (error) => {
        if (error) {
          console.error('[OpenCode] Failed to launch terminal:', error.message);
        }
      });

      res.json({
        success: true,
        cwd,
        terminal: terminalName,
        terminalId
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to launch session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
