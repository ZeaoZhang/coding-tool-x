const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { deleteSession, forkSession, saveSessionOrder, parseRealProjectPath, searchSessions, getRecentSessions, searchSessionsAcrossProjects, hasActualMessages } = require('../services/sessions');
const { getSessionStatus, getSessionOutline, getMessagePage } = require('../services/session-history-index');
const { loadAliases } = require('../services/alias');
const { broadcastLog } = require('../websocket-server');
const { NATIVE_PATHS } = require('../../config/paths');
const {
  defaultProjectInfo,
  emptySessionList,
  getSessionListSnapshot,
  invalidateSessionSnapshots,
  runSessionSnapshotWorker
} = require('../services/session-snapshots');
const { invalidateProjectSnapshots } = require('../services/project-snapshots');
const CLAUDE_PROJECTS_DIR = NATIVE_PATHS.claude.projects;

function resolveClaudeSessionFile(projectName, sessionId, fullPath) {
  const possiblePaths = [
    path.join(fullPath, '.claude', 'sessions', sessionId + '.jsonl'),
    path.join(CLAUDE_PROJECTS_DIR, projectName, sessionId + '.jsonl')
  ];

  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
      return {
        sessionFile: testPath,
        triedPaths: possiblePaths
      };
    }
  }

  return {
    sessionFile: null,
    triedPaths: possiblePaths
  };
}

function getClaudeUserText(content) {
  if (typeof content === 'string') {
    return content === 'Warmup' ? '' : content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts = [];
  for (const item of content) {
    if (item?.type === 'text' && item.text) {
      parts.push(item.text);
    } else if (item?.type === 'image') {
      parts.push('[图片]');
    }
  }

  return parts.join('\n\n').trim();
}

function buildOutlinePreview(text = '') {
  const firstLine = String(text)
    .split('\n')
    .map(line => line.trim())
    .find(Boolean) || '（空消息）';
  return firstLine.length > 42 ? `${firstLine.slice(0, 42)}...` : firstLine;
}

async function readClaudeSessionOutline(sessionFile) {
  const outline = [];
  const stream = fs.createReadStream(sessionFile, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let userMessageNumber = 0;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      let json;
      try {
        json = JSON.parse(line);
      } catch (err) {
        continue;
      }

      if (json.type !== 'user') {
        continue;
      }

      const userText = getClaudeUserText(json.message?.content);
      if (!userText) {
        continue;
      }

      userMessageNumber += 1;
      outline.push({
        userMessageNumber,
        preview: buildOutlinePreview(userText),
        timestamp: json.timestamp || null
      });
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return outline;
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

module.exports = (config) => {
  // GET /api/sessions/search/global - Search sessions across all projects
  router.get('/search/global', async (req, res) => {
    try {
      const { keyword, context } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const contextLength = context ? parseInt(context) : 35;
      const results = await searchSessionsAcrossProjects(config, keyword, contextLength);

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
  router.get('/recent/list', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 5;
      const sessions = await getRecentSessions(config, limit);
      res.json({ sessions });
    } catch (error) {
      console.error('Error fetching recent sessions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/:projectName - Get sessions for a project
  router.get('/:projectName', async (req, res) => {
    try {
      const { projectName } = req.params;
      const force = req.query?.fresh === '1';
      const snapshot = await getSessionListSnapshot('claude', projectName, {
        fallbackValue: emptySessionList(projectName, {
          aliases: loadAliases(),
          projectInfo: defaultProjectInfo(projectName)
        }),
        force,
        refresh: () => runSessionSnapshotWorker('claude', projectName, config, { force })
      });
      res.json({ ...snapshot.value, meta: snapshot.meta });
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
      invalidateSessionSnapshots('claude', projectName);
      invalidateProjectSnapshots('claude');
      res.json(result);
    } catch (error) {
      console.error('Error deleting session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/sessions/:projectName/batch-delete - Delete multiple sessions
  router.post('/:projectName/batch-delete', (req, res) => {
    try {
      const { projectName } = req.params;
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
          deleteSession(config, projectName, sessionId);
          deletedSessionIds.push(sessionId);
        } catch (error) {
          failed.push({
            sessionId,
            error: error.message
          });
        }
      });

      if (deletedSessionIds.length > 0) {
        invalidateSessionSnapshots('claude', projectName);
        invalidateProjectSnapshots('claude');
      }

      res.json({
        success: failed.length === 0,
        requestedCount: uniqueSessionIds.length,
        deletedCount: deletedSessionIds.length,
        deletedSessionIds,
        failed
      });
    } catch (error) {
      console.error('Error batch deleting sessions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/sessions/:projectName/:sessionId/fork - Fork a session
  router.post('/:projectName/:sessionId/fork', (req, res) => {
    try {
      const { projectName, sessionId } = req.params;
      const result = forkSession(config, projectName, sessionId, normalizeForkOptions(req.body));
      invalidateSessionSnapshots('claude', projectName);
      invalidateProjectSnapshots('claude');
      res.json(result);
    } catch (error) {
      console.error('Error forking session:', error);
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  // POST /api/sessions/:projectName/create - Create a new session
  router.post('/:projectName/create', (req, res) => {
    try {
      const { projectName } = req.params;
      const { toolType = 'claude' } = req.body; // 'claude', 'codex', 或 'gemini'
      const crypto = require('crypto');

      // 解析项目路径
      const { fullPath } = parseRealProjectPath(projectName);

      // 生成新的 session ID
      const newSessionId = crypto.randomUUID();

      // 根据工具类型决定会话文件路径
      let sessionDir, sessionFile;

      if (toolType === 'claude') {
        // Claude Code: 直接创建在项目的 .claude/sessions/ 目录（与 Claude Code 默认行为一致）
        sessionDir = path.join(fullPath, '.claude', 'sessions');
        sessionFile = path.join(sessionDir, `${newSessionId}.jsonl`);
      } else if (toolType === 'codex') {
        // Codex: ~/.codex/sessions/YYYY/MM/DD/{sessionId}.jsonl
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        sessionDir = path.join(NATIVE_PATHS.codex.sessions, String(year), month, day);
        sessionFile = path.join(sessionDir, `${newSessionId}.jsonl`);
      } else if (toolType === 'gemini') {
        // Gemini: ~/.gemini/tmp/{hash}/chats/{sessionId}.json
        const pathHash = crypto.createHash('sha256').update(fullPath).digest('hex');
        sessionDir = path.join(NATIVE_PATHS.gemini.tmp, pathHash, 'chats');
        sessionFile = path.join(sessionDir, `${newSessionId}.json`);
      } else {
        return res.status(400).json({ error: 'Invalid toolType. Must be claude, codex, or gemini' });
      }

      // 确保目录存在
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      // 创建初始化会话文件
      const timestamp = new Date().toISOString();
      let initialContent;

      if (toolType === 'gemini') {
        // Gemini 使用 JSON 格式
        initialContent = JSON.stringify({
          id: newSessionId,
          projectPath: fullPath,
          createdAt: timestamp,
          messages: []
        }, null, 2);
      } else {
        // Claude 和 Codex 使用 JSONL 格式
        const metadata = {
          type: 'metadata',
          cwd: fullPath,
          gitBranch: null,
          timestamp: timestamp
        };
        initialContent = JSON.stringify(metadata) + '\n';
      }

      fs.writeFileSync(sessionFile, initialContent, 'utf8');

      // 广播日志
      broadcastLog({
        type: 'action',
        action: 'create_session',
        message: `创建新会话: ${newSessionId.substring(0, 8)} (${toolType})`,
        sessionId: newSessionId,
        tool: toolType,
        timestamp: Date.now()
      });

      const snapshotSource = toolType === 'codex' || toolType === 'gemini' ? toolType : 'claude';
      invalidateSessionSnapshots(snapshotSource, projectName);
      invalidateProjectSnapshots(snapshotSource);

      res.json({
        success: true,
        sessionId: newSessionId,
        sessionFile,
        toolType,
        projectName
      });
    } catch (error) {
      console.error('Error creating session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/sessions/:projectName/order - Save session order
  router.post('/:projectName/order', (req, res) => {
    try {
      const { projectName } = req.params;
      const { order } = req.body;
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }
      saveSessionOrder(projectName, order);
      invalidateSessionSnapshots('claude', projectName);
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving session order:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/:projectName/search - Search sessions content
  router.get('/:projectName/search', async (req, res) => {
    try {
      const { projectName } = req.params;
      const { keyword, context } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const contextLength = context ? parseInt(context) : 15;
      const results = await searchSessions(config, projectName, keyword, contextLength);

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

  // GET /api/sessions/:projectName/:sessionId/status - Lightweight status for live sync
  router.get('/:projectName/:sessionId/status', async (req, res) => {
    try {

      // Try session-history-index first for fast lookup
      try {
        const idxStatus = await getSessionStatus('claude', req.params.sessionId, { consistency: 'stale-ok' });
        if (idxStatus) {
          return res.json({
            sessionId: idxStatus.sessionId,
            lastModified: new Date(idxStatus.lastModified).toISOString(),
            size: idxStatus.size
          });
        }
      } catch (_) { /* fall through to direct stat */ }

      const { projectName, sessionId } = req.params;
      const { fullPath } = parseRealProjectPath(projectName);
      const { sessionFile, triedPaths } = resolveClaudeSessionFile(projectName, sessionId, fullPath);

      if (!sessionFile) {
        return res.status(404).json({
          error: `Session file not found: ${sessionId}`,
          triedPaths
        });
      }

      const stats = await fs.promises.stat(sessionFile);
      res.json({
        sessionId,
        lastModified: stats.mtime.toISOString(),
        size: stats.size
      });
    } catch (error) {
      console.error('Error fetching session status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/:projectName/:sessionId/outline - Lightweight user outline for TOC and forking
  router.get('/:projectName/:sessionId/outline', async (req, res) => {
    try {

      // Try session-history-index first for fast lookup
      try {
        const idxOutline = await getSessionOutline('claude', req.params.sessionId, { consistency: 'stale-ok' });
        if (idxOutline) {
          return res.json({
            sessionId: idxOutline.sessionId,
            items: idxOutline.items
          });
        }
      } catch (_) { /* fall through to direct read */ }

      const { projectName, sessionId } = req.params;
      const { fullPath } = parseRealProjectPath(projectName);
      const { sessionFile, triedPaths } = resolveClaudeSessionFile(projectName, sessionId, fullPath);

      if (!sessionFile) {
        return res.status(404).json({
          error: `Session file not found: ${sessionId}`,
          triedPaths
        });
      }

      const outline = await readClaudeSessionOutline(sessionFile);
      res.json({
        sessionId,
        items: outline
      });
    } catch (error) {
      console.error('Error fetching session outline:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/:projectName/:sessionId/messages - Get session messages with pagination
  router.get('/:projectName/:sessionId/messages', async (req, res) => {
    try {

      // Try session-history-index first for fast lookup
      try {
        const { page = 1, limit = 20, order = 'desc' } = req.query;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const idxPage = await getMessagePage('claude', req.params.sessionId, {
          page: pageNum,
          limit: limitNum,
          order
        });
        if (idxPage) {
          return res.json(idxPage);
        }
      } catch (_) { /* fall through to direct file read */ }

      const { projectName, sessionId } = req.params;
      const { page = 1, limit = 20, order = 'desc' } = req.query;

      console.log(`[Messages API] Request for ${projectName}/${sessionId}, page=${page}, limit=${limit}`);

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // Parse real project path
      const { fullPath } = parseRealProjectPath(projectName);
      console.log(`[Messages API] Parsed project path: ${fullPath}`);

      // Try to find session file
      const { sessionFile, triedPaths: possiblePaths } = resolveClaudeSessionFile(projectName, sessionId, fullPath);

      console.log(`[Messages API] Trying paths:`, possiblePaths);

      if (sessionFile) {
        console.log(`[Messages API] Found session file: ${sessionFile}`);
      }

      if (!sessionFile) {
        console.error(`[Messages API] Session file not found for: ${sessionId}`);
        return res.status(404).json({
          error: `Session file not found: ${sessionId}`,
          triedPaths: possiblePaths
        });
      }

      // Check if session has actual messages (not just file-history-snapshots)
      if (!hasActualMessages(sessionFile)) {
        console.warn(`[Messages API] Session ${sessionId} has no actual messages (only file-history-snapshots)`);
        return res.status(404).json({
          error: `Session has no conversation messages: ${sessionId}`,
          reason: 'This session contains only file history snapshots, not actual conversation data'
        });
      }

      // Read and parse session file
      const allMessages = [];
      const metadata = {};

      const stream = fs.createReadStream(sessionFile, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let lastAssistantModel = null;
      let userMessageNumber = 0;

      try {
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);

            if (json.type === 'summary' && json.summary) {
              metadata.summary = json.summary;
            }
            if (json.gitBranch) {
              metadata.gitBranch = json.gitBranch;
            }
            if (json.cwd) {
              metadata.cwd = json.cwd;
            }

            if (json.type === 'user' || json.type === 'assistant') {
              const resolvedModel = json.message?.model || json.model || lastAssistantModel || null;
              const messageId = json.message?.id || json.uuid || null;
              const message = {
                type: json.type,
                content: null,
                timestamp: json.timestamp || null,
                model: resolvedModel,
                messageId,
                subtype: null
              };
              let deferredToolResultContent = '';

              if (json.type === 'user') {
                const normalizedUserText = getClaudeUserText(json.message?.content);
                if (typeof json.message?.content === 'string') {
                  message.content = json.message.content;
                } else if (Array.isArray(json.message?.content)) {
                  const userParts = [];
                  const toolResultParts = [];
                  for (const item of json.message.content) {
                    if (item.type === 'text' && item.text) {
                      userParts.push(item.text);
                    } else if (item.type === 'tool_result') {
                      const resultContent = typeof item.content === 'string'
                        ? item.content
                        : JSON.stringify(item.content, null, 2);
                      toolResultParts.push(`**[工具结果]**\n\`\`\`\n${resultContent}\n\`\`\``);
                    } else if (item.type === 'image') {
                      userParts.push('[图片]');
                    }
                  }

                  if (userParts.length > 0) {
                    message.content = userParts.join('\n\n');
                  }

                  // Claude tool_result is carried in a "user" envelope, but should be rendered as AI tool output.
                  if (toolResultParts.length > 0) {
                    deferredToolResultContent = toolResultParts.join('\n\n');
                  }
                }

                if (normalizedUserText) {
                  userMessageNumber += 1;
                  message.userMessageNumber = userMessageNumber;
                }
              } else if (json.type === 'assistant') {
                if (Array.isArray(json.message?.content)) {
                  const parts = [];
                  for (const item of json.message.content) {
                    if (item.type === 'text' && item.text) {
                      parts.push(item.text);
                    } else if (item.type === 'tool_use') {
                      const inputStr = JSON.stringify(item.input, null, 2);
                      parts.push(`**[调用工具: ${item.name}]**\n\`\`\`json\n${inputStr}\n\`\`\``);
                    } else if (item.type === 'thinking' && item.thinking) {
                      parts.push(`**[思考]**\n${item.thinking}`);
                    }
                  }
                  message.content = parts.join('\n\n') || '[处理中...]';
                } else if (typeof json.message?.content === 'string') {
                  message.content = json.message.content;
                }

                if (message.model) {
                  lastAssistantModel = message.model;
                }
              }

              if (message.content && message.content !== 'Warmup') {
                allMessages.push(message);
              }

              if (deferredToolResultContent) {
                allMessages.push({
                  type: 'assistant',
                  subtype: 'tool_result',
                  content: deferredToolResultContent,
                  timestamp: json.timestamp || null,
                  model: resolvedModel,
                  messageId: messageId ? `${messageId}-tool-result` : null
                });
              }
            }
          } catch (err) {
            // Skip invalid lines
          }
        }
      } finally {
        rl.close();
        stream.destroy();
      }

      // Sort messages (desc = newest first)
      if (order === 'desc') {
        allMessages.reverse();
      }

      console.log(`[Messages API] Parsed ${allMessages.length} total messages`);

      // Pagination
      const total = allMessages.length;
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;
      const messages = allMessages.slice(startIndex, endIndex);
      const hasMore = endIndex < total;

      console.log(`[Messages API] Returning ${messages.length} messages (page ${pageNum}, total ${total})`);

      res.json({
        messages,
        metadata,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          hasMore
        }
      });
    } catch (error) {
      console.error('Error fetching session messages:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/sessions/:projectName/:sessionId/launch - Return session launch command for copy
  router.post('/:projectName/:sessionId/launch', async (req, res) => {
    try {
      const { projectName, sessionId } = req.params;
      const path = require('path');
      const fs = require('fs');

      // Parse real project path (important for cross-project sessions)
      const { fullPath } = parseRealProjectPath(projectName);

      const projectSessionsDir = path.join(fullPath, '.claude', 'sessions');
      const projectSessionFile = path.join(projectSessionsDir, sessionId + '.jsonl');

      // Try to find session file in multiple possible locations
      let sessionFile = null;
      const possiblePaths = [
        projectSessionFile,
        // Location 2: User's .claude/projects directory (ClaudeCode default)
        path.join(CLAUDE_PROJECTS_DIR, projectName, sessionId + '.jsonl')
      ];

      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          sessionFile = testPath;
          break;
        }
      }

      // 如果会话只存在于全局目录，则复制到项目的 .claude/sessions 目录，避免 claude -r 找不到文件
      if (sessionFile && sessionFile !== projectSessionFile) {
        try {
          if (!fs.existsSync(projectSessionsDir)) {
            fs.mkdirSync(projectSessionsDir, { recursive: true });
          }
          fs.copyFileSync(sessionFile, projectSessionFile);
          sessionFile = projectSessionFile;
        } catch (copyError) {
          console.warn('Failed to sync session file to project directory:', copyError.message);
        }
      }

      if (!sessionFile) {
        console.error(`Session file not found in any location for session: ${sessionId}`);
        console.error('Tried paths:', possiblePaths);
        return res.status(404).json({
          error: `No conversation found with session ID: ${sessionId}`,
          details: `Tried locations: ${possiblePaths.join(', ')}`
        });
      }

      // Extract working directory from session file
      let cwd = fullPath; // Default to project directory
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
        console.warn('Unable to extract cwd from session, using project path:', e.message);
      }

      // 确保会话文件在 cwd 的 .claude/sessions/ 目录下
      // 这样 claude -r 才能找到文件
      const cwdSessionsDir = path.join(cwd, '.claude', 'sessions');
      const cwdSessionFile = path.join(cwdSessionsDir, sessionId + '.jsonl');

      // 如果会话文件不在 cwd 的 sessions 目录，复制过去
      if (sessionFile !== cwdSessionFile && !fs.existsSync(cwdSessionFile)) {
        try {
          if (!fs.existsSync(cwdSessionsDir)) {
            fs.mkdirSync(cwdSessionsDir, { recursive: true });
          }
          fs.copyFileSync(sessionFile, cwdSessionFile);
          console.log(`[Launch] Copied session to cwd: ${cwdSessionFile}`);
        } catch (copyError) {
          console.warn('[Launch] Failed to copy session file to cwd:', copyError.message);
          // 如果复制失败，尝试更新 cwd 为项目目录
          if (fs.existsSync(projectSessionsDir)) {
            cwd = fullPath;
            console.log(`[Launch] Fallback to project directory: ${cwd}`);
          }
        }
      }

      // Get alias
      const aliases = loadAliases();
      const alias = aliases[sessionId];

      // 广播行为日志
      broadcastLog({
        type: 'action',
        action: 'launch_session',
        message: `复制会话启动命令 ${alias || sessionId.substring(0, 8)} (claude)`,
        sessionId,
        alias: alias || null,
        tool: 'claude',
        timestamp: Date.now()
      });

      const command = `claude -r ${sessionId}`;
      const quotedCwd = `"${String(cwd).replace(/"/g, '\\"')}"`;
      const copyCommand = `cd ${quotedCwd} && ${command}`;

      res.json({
        success: true,
        cwd,
        sessionFile,
        sessionId,
        tool: 'claude',
        command,
        copyCommand
      });
    } catch (error) {
      console.error('Error preparing launch command:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
