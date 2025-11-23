const express = require('express');
const router = express.Router();
const {
  getProjectSessions,
  getSessionById,
  searchSessions,
  forkSession,
  deleteSession,
  getRecentSessions,
  saveSessionOrder,
  getProjectPath,
  getAllSessions
} = require('../services/gemini-sessions');
const { isGeminiInstalled } = require('../services/gemini-config');
const { loadAliases } = require('../services/alias');
const { getTerminalLaunchCommand } = require('../services/terminal-config');

module.exports = (config) => {
  /**
   * GET /api/gemini/sessions/search/global?keyword=xxx
   * 全局搜索
   */
  router.get('/search/global', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { keyword } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const results = searchSessions(keyword);

      res.json({
        keyword,
        totalMatches: results.reduce((sum, r) => sum + r.matchCount, 0),
        sessions: results,
        source: 'gemini'
      });
    } catch (err) {
      console.error('[Gemini API] Failed to search sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/gemini/sessions/recent/list?limit=10
   * 获取最近会话
   */
  router.get('/recent/list', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const limit = parseInt(req.query.limit) || 5;
      const sessions = getRecentSessions(limit);

      res.json({
        sessions,
        source: 'gemini'
      });
    } catch (err) {
      console.error('[Gemini API] Failed to get recent sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/gemini/sessions/:projectHash
   * 获取项目的所有会话
   */
  router.get('/:projectHash', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { projectHash } = req.params;
      const sessions = getProjectSessions(projectHash);

      // 计算总大小
      const totalSize = sessions.reduce((sum, session) => {
        return sum + (session.size || 0);
      }, 0);

      // 获取别名
      const aliases = loadAliases();

      // 使用彩虹表解析真实路径
      const realPath = getProjectPath(projectHash);
      const path = require('path');
      const displayName = realPath ? path.basename(realPath) : `Project ${projectHash.substring(0, 8)}`;

      res.json({
        sessions,
        totalSize,
        aliases,
        projectInfo: {
          name: projectHash,
          fullPath: realPath || projectHash,
          path: realPath || projectHash,
          displayName
        }
      });
    } catch (err) {
      console.error('[Gemini API] Failed to get sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/gemini/sessions/:projectHash/search
   * 搜索项目内会话内容
   */
  router.get('/:projectHash/search', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { projectHash } = req.params;
      const { keyword, context } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const contextLength = context ? parseInt(context) : 35;

      // 搜索所有会话，然后过滤该项目的会话
      const allResults = searchSessions(keyword, contextLength);
      const results = allResults.filter(r => r.projectHash === projectHash);

      res.json({
        keyword,
        totalMatches: results.reduce((sum, r) => sum + r.matchCount, 0),
        sessions: results
      });
    } catch (err) {
      console.error('[Gemini API] Failed to search sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/gemini/sessions/:projectHash/:sessionId/messages
   * 获取会话的消息列表
   */
  router.get('/:projectHash/:sessionId/messages', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { sessionId } = req.params;
      const { page = 1, limit = 20, order = 'desc' } = req.query;

      const session = getSessionById(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 转换消息格式为前端期望的格式
      const convertedMessages = [];

      for (const msg of session.messages || []) {
        // 用户消息
        if (msg.type === 'user') {
          convertedMessages.push({
            type: 'user',
            content: msg.content || '[空消息]',
            timestamp: msg.timestamp,
            model: null
          });
        }
        // Gemini 助手消息（type 是 'gemini' 而不是 'assistant'）
        else if (msg.type === 'gemini' || msg.type === 'assistant') {
          let content = msg.content || '[空消息]';

          // 如果有 thoughts（思考过程），添加到内容前面
          if (msg.thoughts && Array.isArray(msg.thoughts) && msg.thoughts.length > 0) {
            const thoughtsText = msg.thoughts.map(t =>
              `**[思考: ${t.subject}]**\n${t.description}`
            ).join('\n\n');

            content = `**[思考过程]**\n${thoughtsText}\n\n---\n\n${content}`;
          }

          convertedMessages.push({
            type: 'assistant',
            content,
            timestamp: msg.timestamp,
            model: msg.model || session.model || 'gemini'
          });
        }
      }

      // 分页处理
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // 排序
      let messages = convertedMessages;
      if (order === 'desc') {
        messages = [...messages].reverse();
      }

      // 分页
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
          model: session.model || 'gemini'
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalMessages,
          hasMore: end < totalMessages
        }
      });
    } catch (err) {
      console.error('[Gemini API] Failed to get session messages:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/gemini/sessions/:projectHash/:sessionId
   * 删除会话
   */
  router.delete('/:projectHash/:sessionId', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { sessionId } = req.params;
      const result = deleteSession(sessionId);

      res.json(result);
    } catch (err) {
      console.error('[Gemini API] Failed to delete session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/sessions/:projectHash/:sessionId/fork
   * Fork 一个会话
   */
  router.post('/:projectHash/:sessionId/fork', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { sessionId } = req.params;
      const result = forkSession(sessionId);

      res.json(result);
    } catch (err) {
      console.error('[Gemini API] Failed to fork session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/sessions/:projectHash/order
   * 保存会话排序
   */
  router.post('/:projectHash/order', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { projectHash } = req.params;
      const { order } = req.body;

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      saveSessionOrder(projectHash, order);

      res.json({ success: true });
    } catch (err) {
      console.error('[Gemini API] Failed to save session order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/sessions/:projectHash/:sessionId/launch
   * 启动会话（打开终端）
   */
  router.post('/:projectHash/:sessionId/launch', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { exec } = require('child_process');
      const { projectHash, sessionId } = req.params;

      // 获取会话详情
      const session = getSessionById(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 使用彩虹表方法获取项目路径
      const projectPath = getProjectPath(projectHash);

      if (!projectPath) {
        return res.status(400).json({
          error: 'Could not resolve project path. The original directory may have been moved or deleted.'
        });
      }

      // 获取该项目的所有会话文件，按 startTime 升序排列（与 gemini --list-sessions 一致）
      const allSessions = getAllSessions()
        .filter(s => s.projectHash === projectHash)
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      // 找到该 sessionId 对应的最新文件的索引
      // 注意：同一个 sessionId 可能有多个文件（继续对话），我们要找最新的那个
      let sessionIndex = -1;
      for (let i = allSessions.length - 1; i >= 0; i--) {
        if (allSessions[i].sessionId === sessionId) {
          sessionIndex = i;
          break;
        }
      }

      if (sessionIndex === -1) {
        return res.status(404).json({ error: 'Session not found in project sessions list' });
      }

      // Gemini 的索引从 1 开始
      const resumeIndex = sessionIndex + 1;

      // 构建 Gemini CLI 命令（使用 --resume <index> 恢复特定会话）
      const geminiCommand = `gemini --resume ${resumeIndex}`;

      try {
        // 获取终端启动命令
        const { command, terminalId, terminalName } = getTerminalLaunchCommand(projectPath, null, geminiCommand);

        console.log(`[Gemini] Launching terminal: ${terminalName} (${terminalId})`);
        console.log(`[Gemini] Resuming session: ${sessionId} (index ${resumeIndex})`);
        console.log(`[Gemini] Command: ${command}`);

        // 异步执行命令，不等待结果
        const shellOption = process.platform === 'win32' ? { shell: 'cmd.exe' } : { shell: true };
        exec(command, shellOption, (error, stdout, stderr) => {
          if (error) {
            console.error(`[Gemini] Failed to launch terminal ${terminalName}:`, error.message);
          }
        });

        // 立即返回成功响应
        res.json({
          success: true,
          sessionId,
          projectPath,
          terminal: terminalName,
          terminalId
        });
      } catch (terminalError) {
        console.error('[Gemini] Failed to get terminal command:', terminalError);
        return res.status(500).json({
          error: 'Failed to launch terminal: ' + terminalError.message
        });
      }
    } catch (err) {
      console.error('[Gemini API] Failed to launch session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
