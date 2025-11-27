const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getAllSessions, parseSessionInfoFast } = require('../../utils/session');
const { loadAliases } = require('./alias');
const {
  getCachedProjects,
  setCachedProjects,
  invalidateProjectsCache,
  checkHasMessagesCache,
  rememberHasMessages
} = require('./session-cache');

// Base directory for cc-tool data
function getCcToolDir() {
  return path.join(os.homedir(), '.claude', 'cc-tool');
}

// Get path for storing project order
function getOrderFilePath() {
  return path.join(getCcToolDir(), 'project-order.json');
}

// Get path for storing fork relations
function getForkRelationsFilePath() {
  return path.join(getCcToolDir(), 'fork-relations.json');
}

// Get path for storing session order
function getSessionOrderFilePath() {
  return path.join(getCcToolDir(), 'session-order.json');
}

// Get saved project order
function getProjectOrder(config) {
  const orderFile = getOrderFilePath();
  try {
    if (fs.existsSync(orderFile)) {
      const data = fs.readFileSync(orderFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    // Ignore errors
  }
  return [];
}

// Save project order
function saveProjectOrder(config, order) {
  const orderFile = getOrderFilePath();
  const dir = path.dirname(orderFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(orderFile, JSON.stringify(order, null, 2), 'utf8');
  invalidateProjectsCache(config);
}

// Get fork relations
function getForkRelations() {
  const relationsFile = getForkRelationsFilePath();
  try {
    if (fs.existsSync(relationsFile)) {
      const data = fs.readFileSync(relationsFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    // Ignore errors
  }
  return {};
}

// Save fork relations
function saveForkRelations(relations) {
  const relationsFile = getForkRelationsFilePath();
  const dir = path.dirname(relationsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(relationsFile, JSON.stringify(relations, null, 2), 'utf8');
}

// Get all projects with stats
function getProjects(config) {
  const projectsDir = config.projectsDir;

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

// Parse real project path from encoded name
// macOS/Linux: "-Users-lilithgames-work-project" -> "/Users/lilithgames/work/project"
// Windows: "C--Users-admin-Desktop-project" -> "C:\Users\admin\Desktop\project"
function parseRealProjectPath(encodedName) {
  const isWindows = process.platform === 'win32';
  const fallbackFromSessions = tryResolvePathFromSessions(encodedName);

  // Detect Windows drive letter (e.g., "C--Users-admin")
  const windowsDriveMatch = encodedName.match(/^([A-Z])--(.+)$/);

  if (isWindows && windowsDriveMatch) {
    // Windows path with drive letter
    const driveLetter = windowsDriveMatch[1];
    const restPath = windowsDriveMatch[2];

    // Split by '-' to get segments
    const segments = restPath.split('-').filter(s => s);

    // Build path from left to right, checking existence
    let realSegments = [];
    let accumulated = '';
    let currentPath = '';

    for (let i = 0; i < segments.length; i++) {
      if (accumulated) {
        accumulated += '-' + segments[i];
      } else {
        accumulated = segments[i];
      }

      const testPath = driveLetter + ':\\' + realSegments.concat(accumulated).join('\\');

      // Check if this path exists
      let found = fs.existsSync(testPath);
      let finalAccumulated = accumulated;

      // If not found with dash, try with underscore
      if (!found && accumulated.includes('-')) {
        const withUnderscore = accumulated.replace(/-/g, '_');
        const testPathUnderscore = driveLetter + ':\\' + realSegments.concat(withUnderscore).join('\\');
        if (fs.existsSync(testPathUnderscore)) {
          finalAccumulated = withUnderscore;
          found = true;
        }
      }

      if (found) {
        realSegments.push(finalAccumulated);
        accumulated = '';
        currentPath = driveLetter + ':\\' + realSegments.join('\\');
      }
    }

    // If there's remaining accumulated segment, try underscore variant
    if (accumulated) {
      let finalAccumulated = accumulated;
      if (accumulated.includes('-')) {
        const withUnderscore = accumulated.replace(/-/g, '_');
        const testPath = driveLetter + ':\\' + realSegments.concat(withUnderscore).join('\\');
        if (fs.existsSync(testPath)) {
          finalAccumulated = withUnderscore;
        }
      }
      realSegments.push(finalAccumulated);
      currentPath = driveLetter + ':\\' + realSegments.join('\\');
    }

    return {
      fullPath: validateProjectPath(currentPath) || fallbackFromSessions?.fullPath || (driveLetter + ':\\' + restPath.replace(/-/g, '\\')),
      projectName: fallbackFromSessions?.projectName || realSegments[realSegments.length - 1] || encodedName
    };
  } else {
    // Unix-like path (macOS/Linux) or fallback
    const pathStr = encodedName.replace(/^-/, '/').replace(/-/g, '/');
    const segments = pathStr.split('/').filter(s => s);

    // Build path from left to right, checking existence
    let currentPath = '';
    const realSegments = [];
    let accumulated = '';

    for (let i = 0; i < segments.length; i++) {
      if (accumulated) {
        accumulated += '-' + segments[i];
      } else {
        accumulated = segments[i];
      }

      const testPath = '/' + realSegments.concat(accumulated).join('/');

      // Check if this path exists
      let found = fs.existsSync(testPath);
      let finalAccumulated = accumulated;

      // If not found with dash, try with underscore
      if (!found && accumulated.includes('-')) {
        const withUnderscore = accumulated.replace(/-/g, '_');
        const testPathUnderscore = '/' + realSegments.concat(withUnderscore).join('/');
        if (fs.existsSync(testPathUnderscore)) {
          finalAccumulated = withUnderscore;
          found = true;
        }
      }

      if (found) {
        realSegments.push(finalAccumulated);
        accumulated = '';
        currentPath = '/' + realSegments.join('/');
      }
    }

    // If there's remaining accumulated segment, try underscore variant
    if (accumulated) {
      let finalAccumulated = accumulated;
      if (accumulated.includes('-')) {
        const withUnderscore = accumulated.replace(/-/g, '_');
        const testPath = '/' + realSegments.concat(withUnderscore).join('/');
        if (fs.existsSync(testPath)) {
          finalAccumulated = withUnderscore;
        }
      }
      realSegments.push(finalAccumulated);
      currentPath = '/' + realSegments.join('/');
    }

    return {
      fullPath: validateProjectPath(currentPath) || fallbackFromSessions?.fullPath || pathStr,
      projectName: fallbackFromSessions?.projectName || realSegments[realSegments.length - 1] || encodedName
    };
  }
}

function validateProjectPath(candidatePath) {
  if (candidatePath && fs.existsSync(candidatePath)) {
    return candidatePath;
  }
  return null;
}

function tryResolvePathFromSessions(encodedName) {
  try {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', encodedName);
    if (!fs.existsSync(projectDir)) {
      return null;
    }
    const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const sessionFile = path.join(projectDir, file);
      const cwd = extractCwdFromSessionHeader(sessionFile);
      if (cwd && fs.existsSync(cwd)) {
        return {
          fullPath: cwd,
          projectName: path.basename(cwd)
        };
      }
    }
  } catch (err) {
    // ignore fallback errors
  }
  return null;
}

function extractCwdFromSessionHeader(sessionFile) {
  try {
    const fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
    fs.closeSync(fd);
    const content = buffer.slice(0, bytesRead).toString('utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.cwd && typeof json.cwd === 'string') {
          return json.cwd;
        }
      } catch (e) {
        // ignore
      }
    }
  } catch (err) {
    // ignore
  }
  return null;
}

// Get projects with detailed stats (with caching)
function getProjectsWithStats(config, options = {}) {
  if (!options.force) {
    const cached = getCachedProjects(config);
    if (cached) {
      return cached;
    }
  }

  const data = buildProjectsWithStats(config);
  setCachedProjects(config, data);
  return data;
}

function buildProjectsWithStats(config) {
  const projectsDir = config.projectsDir;

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const projectName = entry.name;
      const projectPath = path.join(projectsDir, projectName);

      // Parse real project path
      const { fullPath, projectName: displayName } = parseRealProjectPath(projectName);

      // Get session files (only count sessions with actual messages)
      let sessionCount = 0;
      let lastUsed = null;

      try {
        const files = fs.readdirSync(projectPath);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));

        // Filter: only count sessions that have actual messages (not just file-history-snapshots)
        const sessionFilesWithMessages = jsonlFiles.filter(f => {
          const filePath = path.join(projectPath, f);
          return hasActualMessages(filePath);
        });

        sessionCount = sessionFilesWithMessages.length;

        // Find most recent session (only from sessions with messages)
        if (sessionFilesWithMessages.length > 0) {
          const stats = sessionFilesWithMessages.map(f => {
            const filePath = path.join(projectPath, f);
            const stat = fs.statSync(filePath);
            return stat.mtime.getTime();
          });
          lastUsed = Math.max(...stats);
        }
      } catch (err) {
        // Ignore errors
      }

      return {
        name: projectName, // Keep encoded name for API operations
        displayName, // Project name for display
        fullPath, // Real full path for display
        sessionCount,
        lastUsed
      };
    })
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)); // Sort by last used
}

// 获取 Claude 项目/会话数量（轻量统计）
function getProjectAndSessionCounts(config) {
  const projectsDir = config.projectsDir;
  if (!fs.existsSync(projectsDir)) {
    return { projectCount: 0, sessionCount: 0 };
  }

  let projectCount = 0;
  let sessionCount = 0;

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  entries.forEach((entry) => {
    if (!entry.isDirectory()) {
      return;
    }
    projectCount += 1;
    const projectPath = path.join(projectsDir, entry.name);
    try {
      const files = fs.readdirSync(projectPath);
      sessionCount += files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-')).length;
    } catch (err) {
      // 忽略单个项目的读取错误
    }
  });

  return { projectCount, sessionCount };
}

// Check if a session file has actual messages (not just file-history-snapshots)
function hasActualMessages(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const cached = checkHasMessagesCache(filePath, stats);
    if (typeof cached === 'boolean') {
      return cached;
    }

    const result = scanSessionFileForMessages(filePath);
    rememberHasMessages(filePath, stats, result);
    return result;
  } catch (err) {
    return false;
  }
}

function scanSessionFileForMessages(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const bufferSize = 64 * 1024;
    const buffer = Buffer.alloc(bufferSize);
    const pattern = /"type"\s*:\s*"(user|assistant|summary)"/;
    let leftover = '';
    let bytesRead;

    while ((bytesRead = fs.readSync(fd, buffer, 0, bufferSize, null)) > 0) {
      const chunk = buffer.toString('utf8', 0, bytesRead);
      const combined = leftover + chunk;
      if (pattern.test(combined)) {
        fs.closeSync(fd);
        return true;
      }
      leftover = combined.slice(-64);
    }

    fs.closeSync(fd);
    return false;
  } catch (err) {
    if (fd) {
      try {
        fs.closeSync(fd);
      } catch (e) {
        // ignore
      }
    }
    return false;
  }
}

// Get sessions for a project
function getSessionsForProject(config, projectName) {
  const projectConfig = { ...config, currentProject: projectName };
  const sessions = getAllSessions(projectConfig);
  const forkRelations = getForkRelations();
  const savedOrder = getSessionOrder(projectName);

  // Parse session info and calculate total size, filter out sessions with no messages
  let totalSize = 0;
  const sessionsWithInfo = sessions
    .filter(session => hasActualMessages(session.filePath))
    .map(session => {
      const info = parseSessionInfoFast(session.filePath);
      totalSize += session.size || 0;
      return {
        sessionId: session.sessionId,
        mtime: session.mtime,
        size: session.size,
        filePath: session.filePath,
        gitBranch: info.gitBranch || null,
        firstMessage: info.firstMessage || null,
        forkedFrom: forkRelations[session.sessionId] || null
      };
    });

  // Apply saved order if exists
  let orderedSessions = sessionsWithInfo;
  if (savedOrder.length > 0) {
    const ordered = [];
    const sessionMap = new Map(sessionsWithInfo.map(s => [s.sessionId, s]));

    // Add sessions in saved order
    for (const sessionId of savedOrder) {
      if (sessionMap.has(sessionId)) {
        ordered.push(sessionMap.get(sessionId));
        sessionMap.delete(sessionId);
      }
    }

    // Add remaining sessions (new ones not in saved order)
    ordered.push(...sessionMap.values());
    orderedSessions = ordered;
  }

  return {
    sessions: orderedSessions,
    totalSize
  };
}

// Delete a session
function deleteSession(config, projectName, sessionId) {
  const projectDir = path.join(config.projectsDir, projectName);
  const sessionFile = path.join(projectDir, sessionId + '.jsonl');

  if (!fs.existsSync(sessionFile)) {
    throw new Error('Session not found');
  }

  fs.unlinkSync(sessionFile);
  invalidateProjectsCache(config);
  return { success: true };
}

// Fork a session
function forkSession(config, projectName, sessionId) {
  const projectDir = path.join(config.projectsDir, projectName);
  const sessionFile = path.join(projectDir, sessionId + '.jsonl');

  if (!fs.existsSync(sessionFile)) {
    throw new Error('Session not found');
  }

  // Read the original session
  const content = fs.readFileSync(sessionFile, 'utf8');

  // Generate new session ID (UUID v4)
  const newSessionId = crypto.randomUUID();
  const newSessionFile = path.join(projectDir, newSessionId + '.jsonl');

  // Write to new file
  fs.writeFileSync(newSessionFile, content, 'utf8');

  // Save fork relation
  const forkRelations = getForkRelations();
  forkRelations[newSessionId] = sessionId;
  saveForkRelations(forkRelations);
  invalidateProjectsCache(config);

  return { newSessionId, forkedFrom: sessionId };
}

// Get session order for a project
function getSessionOrder(projectName) {
  const orderFile = getSessionOrderFilePath();
  try {
    if (fs.existsSync(orderFile)) {
      const data = fs.readFileSync(orderFile, 'utf8');
      const allOrders = JSON.parse(data);
      return allOrders[projectName] || [];
    }
  } catch (err) {
    // Ignore errors
  }
  return [];
}

// Save session order for a project
function saveSessionOrder(projectName, order) {
  const orderFile = getSessionOrderFilePath();
  const dir = path.dirname(orderFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Read existing orders
  let allOrders = {};
  try {
    if (fs.existsSync(orderFile)) {
      const data = fs.readFileSync(orderFile, 'utf8');
      allOrders = JSON.parse(data);
    }
  } catch (err) {
    // Ignore errors
  }

  // Update order for this project
  allOrders[projectName] = order;
  fs.writeFileSync(orderFile, JSON.stringify(allOrders, null, 2), 'utf8');
}

// Delete a project (remove the entire project directory)
function deleteProject(config, projectName) {
  const projectDir = path.join(config.projectsDir, projectName);

  if (!fs.existsSync(projectDir)) {
    throw new Error('Project not found');
  }

  // Recursively delete the directory
  fs.rmSync(projectDir, { recursive: true, force: true });

  // Remove from order file if exists
  const order = getProjectOrder(config);
  const newOrder = order.filter(name => name !== projectName);
  if (newOrder.length !== order.length) {
    saveProjectOrder(config, newOrder);
  }

  invalidateProjectsCache(config);
  return { success: true };
}

// Search sessions for keyword
function searchSessions(config, projectName, keyword, contextLength = 15) {
  const projectDir = path.join(config.projectsDir, projectName);

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const results = [];
  const files = fs.readdirSync(projectDir);
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));
  const aliases = loadAliases();

  for (const file of jsonlFiles) {
    const sessionId = file.replace('.jsonl', '');
    const filePath = path.join(projectDir, file);

    // Skip sessions with no actual messages
    if (!hasActualMessages(filePath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const matches = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);

          // Search in message content
          if (json.message && json.message.content) {
            const text = json.message.content;
            const lowerText = text.toLowerCase();
            const lowerKeyword = keyword.toLowerCase();
            let index = 0;

            while ((index = lowerText.indexOf(lowerKeyword, index)) !== -1) {
              // Extract context
              const start = Math.max(0, index - contextLength);
              const end = Math.min(text.length, index + keyword.length + contextLength);
              const context = text.substring(start, end);

              matches.push({
                role: json.message.role || 'unknown',
                context: (start > 0 ? '...' : '') + context + (end < text.length ? '...' : ''),
                position: index
              });

              index += keyword.length;
            }
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }

      if (matches.length > 0) {
        results.push({
          sessionId,
          alias: aliases[sessionId] || null,
          matchCount: matches.length,
          matches: matches.slice(0, 5) // Limit to 5 matches per session
        });
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  // Sort by match count
  results.sort((a, b) => b.matchCount - a.matchCount);

  return results;
}

// Get recent sessions across all projects
function getRecentSessions(config, limit = 5) {
  const projects = getProjects(config);
  const allSessions = [];
  const forkRelations = getForkRelations();
  const aliases = loadAliases();

  // Collect all sessions from all projects
  projects.forEach(projectName => {
    const projectConfig = { ...config, currentProject: projectName };
    const sessions = getAllSessions(projectConfig);
    const { projectName: displayName, fullPath } = parseRealProjectPath(projectName);

    sessions.forEach(session => {
      // Skip sessions with no actual messages
      if (!hasActualMessages(session.filePath)) {
        return;
      }

      const info = parseSessionInfoFast(session.filePath);
      allSessions.push({
        sessionId: session.sessionId,
        projectName: projectName,
        projectDisplayName: displayName,
        projectFullPath: fullPath,
        mtime: session.mtime,
        size: session.size,
        filePath: session.filePath,
        gitBranch: info.gitBranch || null,
        firstMessage: info.firstMessage || null,
        forkedFrom: forkRelations[session.sessionId] || null,
        alias: aliases[session.sessionId] || null
      });
    });
  });

  // Sort by mtime descending (most recent first)
  allSessions.sort((a, b) => b.mtime - a.mtime);

  // Return top N sessions
  return allSessions.slice(0, limit);
}

// Search sessions across all projects
function searchSessionsAcrossProjects(config, keyword, contextLength = 35) {
  const projects = getProjects(config);
  const allResults = [];

  projects.forEach(projectName => {
    const projectResults = searchSessions(config, projectName, keyword, contextLength);
    const { projectName: displayName, fullPath } = parseRealProjectPath(projectName);

    // Add project info to each result
    projectResults.forEach(result => {
      allResults.push({
        ...result,
        projectName: projectName,
        projectDisplayName: displayName,
        projectFullPath: fullPath
      });
    });
  });

  // Sort by match count
  allResults.sort((a, b) => b.matchCount - a.matchCount);

  return allResults;
}

module.exports = {
  getProjects,
  getProjectsWithStats,
  getSessionsForProject,
  deleteSession,
  forkSession,
  getRecentSessions,
  getProjectOrder,
  saveProjectOrder,
  getSessionOrder,
  saveSessionOrder,
  deleteProject,
  parseRealProjectPath,
  searchSessions,
  searchSessionsAcrossProjects,
  getForkRelations,
  saveForkRelations,
  hasActualMessages,
  getProjectAndSessionCounts
};
