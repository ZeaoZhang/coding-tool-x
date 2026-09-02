'use strict';

const path = require('path');

function totalSizeOf(sessions) {
  return sessions.reduce((sum, session) => sum + (Number(session.size) || 0), 0);
}

function getAliases() {
  const { loadAliases } = require('./alias');
  return loadAliases();
}

async function buildClaudePayload(projectName, config, options = {}) {
  const {
    getSessionsForProject,
    parseRealProjectPath
  } = require('../../platforms/drivers/claude/sessions-implementation');

  const result = await getSessionsForProject(config, projectName, { force: options.force === true });
  const { fullPath, projectName: displayName } = parseRealProjectPath(projectName);

  return {
    sessions: result.sessions,
    totalSize: result.totalSize,
    aliases: getAliases(),
    projectInfo: {
      name: projectName,
      displayName,
      fullPath
    }
  };
}

async function buildCodexPayload(projectName, options = {}) {
  const { getSessionsByProject } = require('../../platforms/drivers/codex/sessions-implementation');
  const sessions = await getSessionsByProject(projectName, { force: options.force === true });

  return {
    sessions,
    totalSize: totalSizeOf(sessions),
    aliases: getAliases(),
    projectInfo: {
      name: projectName,
      fullPath: projectName,
      path: projectName,
      displayName: projectName
    }
  };
}

async function buildGeminiPayload(projectHash, options = {}) {
  const { getProjectSessions, getProjectPath } = require('../../platforms/drivers/gemini/sessions-implementation');
  const sessions = await getProjectSessions(projectHash, { force: options.force === true });
  const realPath = getProjectPath(projectHash, { force: options.force === true });
  const displayName = realPath ? path.basename(realPath) : `Project ${projectHash.substring(0, 8)}`;

  return {
    sessions,
    totalSize: totalSizeOf(sessions),
    aliases: getAliases(),
    projectInfo: {
      name: projectHash,
      fullPath: realPath || projectHash,
      path: realPath || projectHash,
      displayName
    }
  };
}

function buildOpenCodePayload(projectName, options = {}) {
  const { getSessionsByProject, getProjects } = require('../../platforms/drivers/opencode/sessions-implementation');
  const sessions = getSessionsByProject(projectName, { force: options.force === true });
  const firstDirectory = sessions.find(session => session.directory)?.directory;
  const project = firstDirectory ? null : getProjects({ force: options.force === true }).find(p => p.name === projectName);
  const fullPath = firstDirectory || project?.fullPath || projectName;

  return {
    sessions,
    totalSize: totalSizeOf(sessions),
    aliases: getAliases(),
    projectInfo: {
      name: projectName,
      fullPath,
      path: project?.path || fullPath,
      displayName: project?.displayName || (fullPath ? path.basename(fullPath) : projectName)
    }
  };
}

async function buildOmpPayload(projectName, options = {}) {
  const { getProjects, getSessionsByProject } = require('../../platforms/drivers/omp/sessions-implementation');
  const sessions = await getSessionsByProject(projectName, { force: options.force === true });
  const firstDirectory = sessions.find(session => session.directory)?.directory;
  let project = null;
  try {
    project = (await getProjects({ force: options.force === true })).find(p => p.name === projectName) || null;
  } catch {
    project = null;
  }
  const fullPath = project?.fullPath || project?.path || firstDirectory || projectName;

  return {
    sessions,
    totalSize: totalSizeOf(sessions),
    aliases: getAliases(),
    projectInfo: {
      name: projectName,
      fullPath,
      path: project?.path || fullPath,
      displayName: project?.displayName || (fullPath ? path.basename(fullPath) : projectName)
    }
  };
}

async function buildPayload({ source, projectName, config, options }) {
  const snapshotOptions = options || {};
  switch (source) {
    case 'claude':
      return buildClaudePayload(projectName, config || {}, snapshotOptions);
    case 'codex':
      return buildCodexPayload(projectName, snapshotOptions);
    case 'gemini':
      return buildGeminiPayload(projectName, snapshotOptions);
    case 'opencode':
      return buildOpenCodePayload(projectName, snapshotOptions);
    case 'omp':
      return buildOmpPayload(projectName, snapshotOptions);
    default:
      throw new Error(`Unsupported session snapshot source: ${source}`);
  }
}

function attachWorkerHandler() {
  process.on('message', async (message) => {
    try {
      const value = await buildPayload(message || {});
      if (process.send) {
        process.send({ ok: true, value }, () => process.exit(0));
        return;
      }
    } catch (error) {
      if (process.send) {
        process.send({ ok: false, error: error?.message || String(error) }, () => process.exit(1));
        return;
      }
    }
    process.exit(0);
  });
}

if (process.env.CC_TOOL_SESSION_SNAPSHOT_WORKER === '1' || require.main === module) {
  attachWorkerHandler();
}

module.exports = {
  buildPayload
};
