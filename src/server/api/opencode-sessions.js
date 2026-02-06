const express = require('express');
const router = express.Router();
const {
  getSessionsByProject,
  getSessionById,
  searchSessions,
  deleteSession,
  isOpenCodeInstalled
} = require('../services/opencode-sessions');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const results = searchSessions(keyword);

      res.json({
        keyword,
        totalMatches: results.length,
        sessions: results,
        source: 'opencode'
      });
    } catch (err) {
      console.error('[OpenCode API] Failed to search sessions:', err);
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

      // 计算总大小
      const totalSize = sessions.reduce((sum, session) => {
        return sum + (session.size || 0);
      }, 0);

      res.json({
        sessions,
        totalSize,
        aliases: {},
        projectInfo: {
          name: projectName,
          fullPath: projectName,
          path: projectName,
          displayName: projectName
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
          cwd: null,
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
      console.error('[OpenCode API] Failed to delete session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
