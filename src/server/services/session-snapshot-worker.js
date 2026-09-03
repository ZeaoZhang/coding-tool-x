'use strict';

const path = require('path');
const { invokeCapabilityDriver } = require('../api/capability-driver');

function totalSizeOf(sessions) {
  return sessions.reduce((sum, session) => sum + (Number(session.size) || 0), 0);
}

function getAliases() {
  const { loadAliases } = require('./alias');
  return loadAliases();
}

async function buildClaudePayload(projectName, config, options = {}) {
  const result = await invokeCapabilityDriver(
    'claude',
    'sessions',
    'listSessions',
    [config, projectName, { force: options.force === true }]
  );
  const { fullPath, projectName: displayName } = invokeCapabilityDriver(
    'claude',
    'sessions',
    'parseRealProjectPath',
    [projectName]
  );

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
  const sessions = await invokeCapabilityDriver(
    'codex',
    'sessions',
    'listSessions',
    [projectName, { force: options.force === true }]
  );

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
  const sessions = await invokeCapabilityDriver(
    'gemini',
    'sessions',
    'listSessions',
    [projectHash, { force: options.force === true }]
  );
  const realPath = await invokeCapabilityDriver(
    'gemini',
    'sessions',
    'getProjectPath',
    [projectHash, { force: options.force === true }]
  );
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

async function buildOpenCodePayload(projectName, options = {}) {
  const sessions = await invokeCapabilityDriver(
    'opencode',
    'sessions',
    'listSessions',
    [projectName, { force: options.force === true }]
  );
  const projects = await invokeCapabilityDriver('opencode', 'sessions', 'getProjects', [{
    force: options.force === true
  }]);
  const firstDirectory = sessions.find(session => session.directory)?.directory;
  const project = firstDirectory ? null : projects.find(p => p.name === projectName);
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
  const sessions = await invokeCapabilityDriver(
    'omp',
    'sessions',
    'listSessions',
    [projectName, { force: options.force === true }]
  );
  const firstDirectory = sessions.find(session => session.directory)?.directory;
  let project = null;
  try {
    project = (await invokeCapabilityDriver('omp', 'sessions', 'getProjects', [{
      force: options.force === true
    }])).find(p => p.name === projectName) || null;
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
