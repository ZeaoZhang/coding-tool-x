const express = require('express');
const router = express.Router();
const {
  buildLaunchCommand,
  getProjects,
  getSessionsByProject,
  getSessionById,
  getSessionMessages,
  getRecentSessions,
  searchSessions,
  deleteSession,
  forkSession,
  saveSessionOrder,
  isOmpInstalled,
  HOME_DIR
} = require('./sessions-implementation');
const { getSessionStatus, getSessionOutline, getMessagePage } = require('../../../server/services/session-history-index');
const { loadAliases } = require('../../../server/services/alias');
const { broadcastLog } = require('../../../server/websocket-server');
const {
  defaultProjectInfo,
  emptySessionList,
  getSessionListSnapshot,
  invalidateSessionSnapshots,
  runSessionSnapshotWorker
} = require('../../../server/services/session-snapshots');
const { invalidateProjectSnapshots } = require('../../../server/services/project-snapshots');

function isNotFoundError(error) {
  if (!error || !error.message) return false;
  return error.message === 'Session not found' || error.message === 'Project not found';
}

function quoteForShell(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

module.exports = () => {
  router.get('/search/global', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const { keyword } = req.query;
      const parsedContextLength = req.query.context ? parseInt(req.query.context, 10) : 35;
      const contextLength = Number.isFinite(parsedContextLength) ? parsedContextLength : 35;
      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }
      const sessions = await searchSessions(keyword, contextLength);
      const totalMatches = sessions.reduce((sum, session) => sum + (session.matchCount || 0), 0);
      res.json({ keyword, totalMatches, sessions, source: 'omp' });
    } catch (err) {
      console.error('[OMP API] Failed to search sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/recent/list', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const limit = parseInt(req.query.limit, 10) || 5;
      res.json({ sessions: await getRecentSessions(limit), source: 'omp' });
    } catch (err) {
      console.error('[OMP API] Failed to get recent sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:projectName/search', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const { projectName } = req.params;
      const { keyword } = req.query;
      const parsedContextLength = req.query.context ? parseInt(req.query.context, 10) : 35;
      const contextLength = Number.isFinite(parsedContextLength) ? parsedContextLength : 35;
      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }
      const sessions = await searchSessions(keyword, contextLength, projectName);
      const totalMatches = sessions.reduce((sum, session) => sum + (session.matchCount || 0), 0);
      res.json({ keyword, totalMatches, sessions });
    } catch (err) {
      console.error('[OMP API] Failed to search project sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:projectName', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const { projectName } = req.params;
      const force = req.query?.fresh === '1';
      const snapshot = await getSessionListSnapshot('omp', projectName, {
        fallbackValue: emptySessionList(projectName, {
          aliases: loadAliases(),
          projectInfo: defaultProjectInfo(projectName)
        }),
        force,
        refresh: () => runSessionSnapshotWorker('omp', projectName, {}, { force })
      });
      res.json({ ...snapshot.value, meta: snapshot.meta });
    } catch (err) {
      console.error('[OMP API] Failed to get sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:projectName/:sessionId/status', async (req, res) => {
    // Try session-history-index first for fast lookup
    try {
      const idxStatus = await getSessionStatus('omp', req.params.sessionId, { consistency: 'stale-ok' });
      if (idxStatus) {
        return res.json({
          sessionId: idxStatus.sessionId,
          lastModified: new Date(idxStatus.lastModified).toISOString(),
          size: idxStatus.size
        });
      }
    } catch (_) { /* fall through to direct lookup */ }

    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const session = await getSessionById(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({
        sessionId: req.params.sessionId,
        lastModified: session.mtime || null,
        size: session.size || 0
      });
    } catch (err) {
      console.error('[OMP API] Failed to get session status:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:projectName/:sessionId/outline', async (req, res) => {
    // Try session-history-index first for fast lookup
    try {
      const idxOutline = await getSessionOutline('omp', req.params.sessionId, { consistency: 'stale-ok' });
      if (idxOutline) {
        return res.json({
          sessionId: idxOutline.sessionId,
          items: idxOutline.items
        });
      }
    } catch (_) { /* fall through to direct read */ }

    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const session = await getSessionById(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      let userMessageNumber = 0;
      const items = [];
      for (const msg of getSessionMessages(req.params.sessionId)) {
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
      res.json({ sessionId: req.params.sessionId, items });
    } catch (err) {
      console.error('[OMP API] Failed to get session outline:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:projectName/:sessionId/messages', async (req, res) => {
    const startMs = Date.now();
    // Try session-history-index first for fast lookup
    try {
      const { page = 1, limit = 20, order = 'desc' } = req.query;
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const idxPage = await getMessagePage('omp', req.params.sessionId, {
        page: pageNum, limit: limitNum, order
      });
      if (idxPage) {
        return res.json(idxPage);
      }
    } catch (_) { /* fall through to direct file read */ }

    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const { sessionId } = req.params;
      const { page = 1, limit = 20, order = 'desc' } = req.query;
      const session = await getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      let userMessageNumber = 0;
      const convertedMessages = getSessionMessages(sessionId).map((message) => {
        if (message.type !== 'user') return message;
        userMessageNumber += 1;
        return { ...message, userMessageNumber };
      });
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const orderedMessages = order === 'desc' ? [...convertedMessages].reverse() : convertedMessages;
      const start = (pageNum - 1) * limitNum;
      const end = start + limitNum;
      res.json({
        messages: orderedMessages.slice(start, end),
        metadata: {
          gitBranch: null,
          gitRepository: null,
          cwd: session?.directory || null,
          provider: session?.provider || '',
          model: session?.model || 'omp'
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: orderedMessages.length,
          hasMore: end < orderedMessages.length
        }
      });
    } catch (err) {
      console.error('[OMP API] Failed to get session messages:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:projectName/:sessionId', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const result = await deleteSession(req.params.sessionId);
      invalidateSessionSnapshots('omp', req.params.projectName);
      invalidateProjectSnapshots('omp');
      res.json(result);
    } catch (err) {
      if (isNotFoundError(err)) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[OMP API] Failed to delete session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:projectName/batch-delete', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
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
      for (const sessionId of uniqueSessionIds) {
        try {
          await deleteSession(sessionId);
          deletedSessionIds.push(sessionId);
        } catch (err) {
          failed.push({ sessionId, error: err.message });
        }
      }
      if (deletedSessionIds.length > 0) {
        invalidateSessionSnapshots('omp', req.params.projectName);
        invalidateProjectSnapshots('omp');
      }
      res.json({
        success: failed.length === 0,
        requestedCount: uniqueSessionIds.length,
        deletedCount: deletedSessionIds.length,
        deletedSessionIds,
        failed
      });
    } catch (err) {
      console.error('[OMP API] Failed to batch delete sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:projectName/:sessionId/fork', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const result = await forkSession(req.params.sessionId, req.body || {});
      invalidateSessionSnapshots('omp', req.params.projectName);
      invalidateProjectSnapshots('omp');
      res.json(result);
    } catch (err) {
      if (isNotFoundError(err)) {
        return res.status(404).json({ error: err.message });
      }
      console.error('[OMP API] Failed to fork session:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:projectName/order', (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const { order } = req.body || {};
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }
      saveSessionOrder(req.params.projectName, order);
      invalidateSessionSnapshots('omp', req.params.projectName);
      res.json({ success: true });
    } catch (err) {
      console.error('[OMP API] Failed to save session order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:projectName/:sessionId/launch', async (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }
      const { projectName, sessionId } = req.params;
      const session = await getSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const project = (await getProjects()).find(p => p.name === projectName);
      const cwd = session.directory || project?.fullPath || HOME_DIR;
      const command = buildLaunchCommand(sessionId, cwd, req.body || {});
      const copyCommand = `cd ${quoteForShell(cwd)} && ${command}`;

      broadcastLog({
        type: 'action',
        action: 'launch_pi_session',
        message: `复制 OMP 会话启动命令 ${sessionId.substring(0, 8)}`,
        sessionId,
        tool: 'omp',
        toolType: 'omp',
        source: 'omp',
        timestamp: Date.now()
      });

      res.json({
        success: true,
        cwd,
        sessionFile: session.filePath,
        sessionId,
        tool: 'omp',
        command,
        copyCommand
      });
    } catch (err) {
      console.error('[OMP API] Failed to prepare launch command:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
