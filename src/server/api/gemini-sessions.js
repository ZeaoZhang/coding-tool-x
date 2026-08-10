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
const { getSessionStatus, getSessionOutline, getMessagePage } = require('../services/session-history-index');
const { isGeminiInstalled } = require('../services/gemini-config');
const { loadAliases } = require('../services/alias');
const {
  defaultProjectInfo,
  emptySessionList,
  getSessionListSnapshot,
  invalidateSessionSnapshots,
  runSessionSnapshotWorker
} = require('../services/session-snapshots');
const { invalidateProjectSnapshots } = require('../services/project-snapshots');

function normalizeForkOptions(body = {}) {
  const alias = typeof body.alias === 'string' ? body.alias.trim() : '';
  const rawNumber = body.afterUserMessageNumber;
  const hasExplicitNumber = rawNumber !== undefined && rawNumber !== null && rawNumber !== '';
  const parsedNumber = hasExplicitNumber ? parseInt(rawNumber, 10) : null;

  if (hasExplicitNumber && (!Number.isInteger(parsedNumber) || parsedNumber <= 0)) {
    const error = new Error('afterUserMessageNumber must be a positive integer');
    error.statusCode = 400;
    throw error;
  }

  return {
    afterUserMessageNumber: parsedNumber,
    alias: alias || null
  };
}

module.exports = (config) => {
  /**
   * GET /api/gemini/sessions/search/global?keyword=xxx
   * 全局搜索
   */
  router.get('/search/global', async (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { keyword } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const results = await searchSessions(keyword);

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
  router.get('/recent/list', async (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const limit = parseInt(req.query.limit) || 5;
      const sessions = await getRecentSessions(limit);

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
  router.get('/:projectHash', async (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { projectHash } = req.params;
      const force = req.query?.fresh === '1';
      const snapshot = await getSessionListSnapshot('gemini', projectHash, {
        fallbackValue: emptySessionList(projectHash, {
          aliases: loadAliases(),
          projectInfo: defaultProjectInfo(projectHash)
        }),
        force,
        refresh: () => runSessionSnapshotWorker('gemini', projectHash, {}, { force })
      });
      res.json({ ...snapshot.value, meta: snapshot.meta });
    } catch (err) {
      console.error('[Gemini API] Failed to get sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/gemini/sessions/:projectHash/search
   * 搜索项目内会话内容
   */
  router.get('/:projectHash/search', async (req, res) => {
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
      const allResults = await searchSessions(keyword, contextLength);
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

  router.get('/:projectHash/:sessionId/status', async (req, res) => {
    // Try session-history-index first for fast lookup
    try {
      const idxStatus = await getSessionStatus('gemini', req.params.sessionId, { consistency: 'stale-ok' });
      if (idxStatus) {
        return res.json({
          sessionId: idxStatus.sessionId,
          lastModified: new Date(idxStatus.lastModified).toISOString(),
          size: idxStatus.size
        });
      }
    } catch (_) { /* fall through to direct lookup */ }

    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { sessionId } = req.params;
      const session = await getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({
        sessionId,
        lastModified: session.lastUpdated || session.mtime || null,
        size: session.size || 0
      });
    } catch (err) {
      console.error('[Gemini API] Failed to get session status:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:projectHash/:sessionId/outline', async (req, res) => {
    // Try session-history-index first for fast lookup
    try {
      const idxOutline = await getSessionOutline('gemini', req.params.sessionId, { consistency: 'stale-ok' });
      if (idxOutline) {
        return res.json({
          sessionId: idxOutline.sessionId,
          items: idxOutline.items
        });
      }
    } catch (_) { /* fall through to direct read */ }

    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { sessionId } = req.params;
      const session = await getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      let userMessageNumber = 0;
      const items = [];
      for (const msg of session.messages || []) {
        if (msg.type !== 'user') continue;
        const preview = typeof msg.content === 'string' ? msg.content.trim() : '';
        if (!preview) continue;
        userMessageNumber += 1;
        items.push({
          userMessageNumber,
          preview: preview.length > 42 ? `${preview.slice(0, 42)}...` : preview,
          timestamp: msg.timestamp || null
        });
      }

      res.json({
        sessionId,
        items
      });
    } catch (err) {
      console.error('[Gemini API] Failed to get session outline:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/gemini/sessions/:projectHash/:sessionId/messages
   * 获取会话的消息列表
   */
  router.get('/:projectHash/:sessionId/messages', async (req, res) => {
    const startMs = Date.now();
    // Try session-history-index first for fast lookup
    try {
      const { page = 1, limit = 20, order = 'desc' } = req.query;
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const idxPage = await getMessagePage('gemini', req.params.sessionId, {
        page: pageNum, limit: limitNum, order
      });
      if (idxPage) {
        return res.json(idxPage);
      }
    } catch (_) { /* fall through to direct file read */ }

    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { sessionId } = req.params;
      const { page = 1, limit = 20, order = 'desc' } = req.query;

      const session = await getSessionById(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 转换消息格式为前端期望的格式
      const convertedMessages = [];

      let userMessageNumber = 0;
      for (const msg of session.messages || []) {
        // 用户消息
        if (msg.type === 'user') {
          userMessageNumber += 1;
          convertedMessages.push({
            type: 'user',
            content: msg.content || '[空消息]',
            timestamp: msg.timestamp,
            model: null,
            userMessageNumber
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
      invalidateSessionSnapshots('gemini', req.params.projectHash);
      invalidateProjectSnapshots('gemini');

      res.json(result);
    } catch (err) {
      console.error('[Gemini API] Failed to delete session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/sessions/:projectHash/batch-delete
   * 批量删除会话
   */
  router.post('/:projectHash/batch-delete', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
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

      if (deletedSessionIds.length > 0) {
        invalidateSessionSnapshots('gemini', req.params.projectHash);
        invalidateProjectSnapshots('gemini');
      }

      res.json({
        success: failed.length === 0,
        requestedCount: uniqueSessionIds.length,
        deletedCount: deletedSessionIds.length,
        deletedSessionIds,
        failed
      });
    } catch (err) {
      console.error('[Gemini API] Failed to batch delete sessions:', err);
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
      const result = forkSession(sessionId, normalizeForkOptions(req.body));
      invalidateSessionSnapshots('gemini', req.params.projectHash);
      invalidateProjectSnapshots('gemini');

      res.json(result);
    } catch (err) {
      console.error('[Gemini API] Failed to fork session:', err);
      res.status(err.statusCode || 500).json({ error: err.message });
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
      invalidateSessionSnapshots('gemini', projectHash);

      res.json({ success: true });
    } catch (err) {
      console.error('[Gemini API] Failed to save session order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/sessions/:projectHash/:sessionId/launch
   * 获取会话启动命令（用于复制）
   */
  router.post('/:projectHash/:sessionId/launch', async (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { projectHash, sessionId } = req.params;

      // 获取会话详情
      const session = await getSessionById(sessionId);

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
      const command = `gemini --resume ${resumeIndex}`;
      const quotedCwd = `"${String(projectPath).replace(/"/g, '\\"')}"`;
      const copyCommand = `cd ${quotedCwd} && ${command}`;

      res.json({
        success: true,
        sessionId,
        projectPath,
        cwd: projectPath,
        tool: 'gemini',
        command,
        copyCommand
      });
    } catch (err) {
      console.error('[Gemini API] Failed to prepare launch command:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
