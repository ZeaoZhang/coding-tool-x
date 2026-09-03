const express = require('express');
const router = express.Router();
const { invokeCapabilityDriver } = require('../../../server/api/capability-driver');
const { isCodexInstalled } = require('./config');
const { loadAliases } = require('../../../server/services/alias');
const {
  defaultProjectInfo,
  emptySessionList,
  getSessionListSnapshot,
  invalidateSessionSnapshots,
  runSessionSnapshotWorker
} = require('../../../server/services/session-snapshots');
const { invalidateProjectSnapshots } = require('../../../server/services/project-snapshots');

const DEBUG_CODEX_PERF = process.env.DEBUG_CODEX_PERF === '1';

function logPerf(route, startMs, detail = '') {
  if (!DEBUG_CODEX_PERF) return;
  const duration = Date.now() - startMs;
  const suffix = detail ? ` | ${detail}` : '';
  console.log(`[Codex Perf] ${route}: ${duration}ms${suffix}`);
}

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

function withUserAnchorContext(paginatedMessages, sortedMessages) {
  if (paginatedMessages.length === 0 || paginatedMessages.some(message => message.type === 'user')) {
    return paginatedMessages;
  }

  const userAnchor = sortedMessages.find(message => message.type === 'user' && message.userMessageNumber);
  if (!userAnchor) {
    return paginatedMessages;
  }

  return [
    ...paginatedMessages,
    {
      type: 'user',
      content: '',
      timestamp: userAnchor.timestamp || null,
      model: null,
      userMessageNumber: userAnchor.userMessageNumber,
      anchorOnly: true
    }
  ];
}

module.exports = (config) => {
  // ============================================
  // 静态路由必须放在参数路由之前
  // ============================================

  /**
   * GET /api/codex/sessions/search/global?keyword=xxx
   * 全局搜索
   */
  const invokeSession = (operation, args = []) => (
    invokeCapabilityDriver('codex', 'sessions', operation, args)
  );
  router.get('/search/global', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { keyword } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const results = await invokeSession('search', [keyword]);

      // 按会话分组，统计每个会话的匹配数
      const sessionMap = new Map();
      results.forEach(match => {
        if (!sessionMap.has(match.sessionId)) {
          sessionMap.set(match.sessionId, {
            sessionId: match.sessionId,
            projectName: match.projectName,
            matchCount: 0,
            matches: []
          });
        }
        const session = sessionMap.get(match.sessionId);
        session.matchCount++;
        session.matches.push({
          messageIndex: match.messageIndex,
          role: match.role,
          context: match.context,
          timestamp: match.timestamp
        });
      });

      const sessions = Array.from(sessionMap.values());

      res.json({
        keyword,
        totalMatches: results.length,
        sessions,
        source: 'codex'
      });
    } catch (err) {
      console.error('[Codex API] Failed to search sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/codex/sessions/recent/list?limit=10
   * 获取最近会话
   */
  router.get('/recent/list', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const limit = parseInt(req.query.limit) || 5;
      const sessions = await invokeSession('recent', [limit]);

      res.json({
        sessions,
        source: 'codex'
      });
    } catch (err) {
      console.error('[Codex API] Failed to get recent sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // 参数路由
  // ============================================

  /**
   * GET /api/codex/sessions/:projectName
   * 获取项目的所有会话
   */
  router.get('/:projectName', async (req, res) => {
    const startMs = Date.now();
    try {
      if (!isCodexInstalled()) {
        logPerf('GET /api/codex/sessions/:projectName', startMs, 'codex not installed');
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { projectName } = req.params;
      const force = req.query?.fresh === '1';
      const snapshot = await getSessionListSnapshot('codex', projectName, {
        fallbackValue: emptySessionList(projectName, {
          aliases: loadAliases(),
          projectInfo: defaultProjectInfo(projectName)
        }),
        force,
        refresh: () => runSessionSnapshotWorker('codex', projectName, {}, { force })
      });
      logPerf('GET /api/codex/sessions/:projectName', startMs, `project=${projectName}, sessions=${snapshot.value.sessions.length}, stale=${snapshot.meta.stale}`);

      res.json({ ...snapshot.value, meta: snapshot.meta });
    } catch (err) {
      console.error('[Codex API] Failed to get sessions:', err);
      logPerf('GET /api/codex/sessions/:projectName', startMs, `error=${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/codex/sessions/:projectName/search
   * 项目级搜索
   */
  router.get('/:projectName/search', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { projectName } = req.params;
      const { keyword, context } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      // 使用全局搜索，然后过滤项目
      const allResults = await invokeSession('search', [keyword]);
      const filteredResults = allResults.filter(r => r.projectName === projectName);

      // 按会话分组
      const sessionMap = new Map();
      filteredResults.forEach(match => {
        if (!sessionMap.has(match.sessionId)) {
          sessionMap.set(match.sessionId, {
            sessionId: match.sessionId,
            projectName: match.projectName,
            matchCount: 0,
            matches: []
          });
        }
        const session = sessionMap.get(match.sessionId);
        session.matchCount++;
        session.matches.push({
          messageIndex: match.messageIndex,
          role: match.role,
          context: match.context,
          timestamp: match.timestamp
        });
      });

      const sessions = Array.from(sessionMap.values());

      res.json({
        keyword,
        totalMatches: filteredResults.length,
        sessions
      });
    } catch (err) {
      console.error('[Codex API] Failed to search project sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:projectName/:sessionId/status', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { sessionId } = req.params;
      const session = await invokeSession('getSessionById', [sessionId]);
      if (!session || !session.filePath) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const fs = require('fs');
      const stats = fs.statSync(session.filePath);
      res.json({
        sessionId,
        lastModified: stats.mtime.toISOString(),
        size: stats.size
      });
    } catch (err) {
      console.error('[Codex API] Failed to get session status:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:projectName/:sessionId/outline', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { sessionId } = req.params;
      const session = await invokeSession('getSessionById', [sessionId]);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      let userMessageNumber = 0;
      const items = [];
      for (const msg of session.messages || []) {
        if (msg.role !== 'user') continue;
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
      console.error('[Codex API] Failed to get session outline:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/codex/sessions/:projectName/:sessionId/messages
   * 获取会话的消息列表
   */
  router.get('/:projectName/:sessionId/messages', async (req, res) => {
    const startMs = Date.now();
    try {
      if (!isCodexInstalled()) {
        logPerf('GET /api/codex/sessions/:projectName/:sessionId/messages', startMs, 'codex not installed');
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { sessionId } = req.params;
      const { page = 1, limit = 20, order = 'desc' } = req.query;

      const session = await invokeSession('getSessionById', [sessionId]);

      if (!session) {
        logPerf('GET /api/codex/sessions/:projectName/:sessionId/messages', startMs, `session=${sessionId}, not found`);
        return res.status(404).json({ error: 'Session not found' });
      }

      // 转换消息格式为前端期望的格式
      const convertedMessages = [];

      let userMessageNumber = 0;
      for (const msg of session.messages) {
        // 用户消息
        if (msg.role === 'user') {
          userMessageNumber += 1;
          convertedMessages.push({
            type: 'user',
            content: msg.content || '[空消息]',
            timestamp: msg.timestamp,
            model: null,
            userMessageNumber
          });
        }
        // 助手消息（普通回复）
        else if (msg.role === 'assistant') {
          convertedMessages.push({
            type: 'assistant',
            content: msg.content || '[空消息]',
            timestamp: msg.timestamp,
            model: msg.model || session.provider || 'codex'
          });
        }
        // 推理内容
        else if (msg.role === 'reasoning') {
          convertedMessages.push({
            type: 'assistant',
            content: `**[推理]**\n${msg.content || '[空推理]'}`,
            timestamp: msg.timestamp,
            model: msg.model || session.provider || 'codex'
          });
        }
        // 工具调用
        else if (msg.role === 'tool_call') {
          const argsStr = typeof msg.arguments === 'object'
            ? JSON.stringify(msg.arguments, null, 2)
            : msg.arguments;
          convertedMessages.push({
            type: 'assistant',
            content: `**[调用工具: ${msg.name}]**\n\`\`\`json\n${argsStr}\n\`\`\``,
            timestamp: msg.timestamp,
            model: msg.model || session.provider || 'codex'
          });
        }
        // 工具输出
        else if (msg.role === 'tool_output') {
          let outputStr = '';
          if (typeof msg.output === 'object' && msg.output.output) {
            // 标准格式：{ output: '...', metadata: {...} }
            outputStr = msg.output.output;
            if (msg.output.metadata) {
              const meta = msg.output.metadata;
              outputStr += `\n\n**[元数据]**\n- 退出码: ${meta.exit_code || 0}\n- 耗时: ${meta.duration_seconds || 0}s`;
            }
          } else if (typeof msg.output === 'string') {
            outputStr = msg.output;
          } else {
            outputStr = JSON.stringify(msg.output, null, 2);
          }

          convertedMessages.push({
            type: 'assistant',
            subtype: 'tool_result',
            content: `**[工具结果]**\n\`\`\`\n${outputStr}\n\`\`\``,
            timestamp: msg.timestamp,
            model: msg.model || session.provider || 'codex'
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
      const paginatedMessages = withUserAnchorContext(messages.slice(start, end), messages);

      res.json({
        messages: paginatedMessages,
        metadata: {
          gitBranch: session.gitBranch,
          gitRepository: session.gitRepository,
          cwd: session.cwd,
          provider: session.provider
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalMessages,
          hasMore: end < totalMessages
        }
      });
      logPerf(
        'GET /api/codex/sessions/:projectName/:sessionId/messages',
        startMs,
        `session=${sessionId}, total=${totalMessages}, page=${pageNum}, returned=${paginatedMessages.length}`
      );
    } catch (err) {
      console.error('[Codex API] Failed to get session messages:', err);
      logPerf('GET /api/codex/sessions/:projectName/:sessionId/messages', startMs, `error=${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/codex/sessions/:projectName/:sessionId
   * 删除会话
   */
  router.delete('/:projectName/:sessionId', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { sessionId } = req.params;
      const result = invokeSession('delete', [sessionId]);
      invalidateSessionSnapshots('codex', req.params.projectName);
      invalidateProjectSnapshots('codex');

      res.json(result);
    } catch (err) {
      console.error('[Codex API] Failed to delete session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/codex/sessions/:projectName/batch-delete
   * 批量删除会话
   */
  router.post('/:projectName/batch-delete', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
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
          invokeSession('delete', [sessionId]);
          deletedSessionIds.push(sessionId);
        } catch (err) {
          failed.push({
            sessionId,
            error: err.message
          });
        }
      });

      if (deletedSessionIds.length > 0) {
        invalidateSessionSnapshots('codex', req.params.projectName);
        invalidateProjectSnapshots('codex');
      }

      res.json({
        success: failed.length === 0,
        requestedCount: uniqueSessionIds.length,
        deletedCount: deletedSessionIds.length,
        deletedSessionIds,
        failed
      });
    } catch (err) {
      console.error('[Codex API] Failed to batch delete sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/codex/sessions/:projectName/:sessionId/fork
   * Fork 一个会话
   */
  router.post('/:projectName/:sessionId/fork', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { sessionId } = req.params;
      const result = invokeSession('fork', [sessionId, normalizeForkOptions(req.body)]);
      invalidateSessionSnapshots('codex', req.params.projectName);
      invalidateProjectSnapshots('codex');

      res.json(result);
    } catch (err) {
      console.error('[Codex API] Failed to fork session:', err);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /**
   * POST /api/codex/sessions/:projectName/order
   * 保存会话排序
   */
  router.post('/:projectName/order', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { projectName } = req.params;
      const { order } = req.body;

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      invokeSession('saveSessionOrder', [projectName, order]);
      invalidateSessionSnapshots('codex', projectName);

      res.json({ success: true });
    } catch (err) {
      console.error('[Codex API] Failed to save session order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/codex/sessions/:projectName/:sessionId/launch
   * 获取会话启动命令（用于复制）
   */
  router.post('/:projectName/:sessionId/launch', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { sessionId } = req.params;
      const fs = require('fs');

      // 获取会话详情
      const session = await invokeSession('getSessionById', [sessionId]);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 从会话文件提取 cwd
      let cwd = null;
      try {
        if (session.filePath && fs.existsSync(session.filePath)) {
          const content = fs.readFileSync(session.filePath, 'utf8');
          const firstLine = content.split('\n')[0];
          if (firstLine) {
            const json = JSON.parse(firstLine);
            if (json.type === 'session_meta' && json.payload?.cwd) {
              cwd = json.payload.cwd;
            }
          }
        }
      } catch (e) {
        console.warn('Unable to extract cwd from Codex session:', e.message);
      }

      if (!cwd) {
        return res.status(400).json({
          error: 'Unable to determine working directory from session'
        });
      }

      // 获取别名
      const { loadAliases } = require('../../../server/services/alias');
      const aliases = loadAliases();
      const alias = aliases[sessionId];

      // 广播行为日志
      const { broadcastLog } = require('../../../server/websocket-server');
      broadcastLog({
        type: 'action',
        action: 'launch_codex_session',
        message: `复制 Codex 会话启动命令 ${alias || sessionId.substring(0, 8)}`,
        sessionId: sessionId,
        alias: alias || null,
        timestamp: Date.now()
      });

      const command = `codex resume ${sessionId}`;
      const quotedCwd = `"${String(cwd).replace(/"/g, '\\"')}"`;
      const copyCommand = `cd ${quotedCwd} && ${command}`;

      res.json({
        success: true,
        cwd,
        sessionFile: session.filePath,
        sessionId,
        tool: 'codex',
        command,
        copyCommand
      });
    } catch (err) {
      console.error('[Codex API] Failed to prepare launch command:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
