'use strict';

const path = require('path');
const { getPlatformContext } = require('../platform-context');

function invokeSessionDriver(platform, capability, operation, args = [], runtime = null) {
  const resolvedRuntime = runtime || getPlatformContext().runtime;
  const driver = resolvedRuntime?.getDriver?.(platform, capability);
  if (!driver || typeof driver[operation] !== 'function') {
    const error = new Error(`平台 ${platform} 未声明 ${capability}.${operation} capability`);
    error.status = 404;
    error.code = 'unsupported';
    error.platform = platform;
    error.capability = capability;
    error.operation = operation;
    throw error;
  }
  const result = driver[operation](...args);
  const unwrap = value => {
    if (!value || typeof value !== 'object' || !value.status) return value;
    if (value.status === 'ok') return value.data;
    if (value.cause instanceof Error) throw value.cause;
    const error = new Error(value.error || `平台 ${platform} 的 ${capability}.${operation} 失败`);
    Object.assign(error, {
      status: value.status,
      platform: value.platform || platform,
      capability: value.capability || capability,
      operation: value.operation || operation
    });
    throw error;
  };
  return result && typeof result.then === 'function' ? result.then(unwrap) : unwrap(result);
}

function totalSizeOf(sessions) {
  return sessions.reduce((sum, session) => sum + (Number(session.size) || 0), 0);
}

function getAliases() {
  const { loadAliases } = require('./alias');
  return loadAliases();
}

function indexedReadOptions(options = {}, config) {
  const force = options.force === true;
  return {
    force,
    ...(force ? { consistency: 'complete' } : {}),
    ...(config ? { config } : {})
  };
}

async function buildClaudePayload(projectName, config, options = {}, runtime = null) {
  const result = await invokeSessionDriver(
    'claude',
    'sessions',
    'listSessions',
    [projectName, indexedReadOptions(options, config)],
    runtime
  );
  const { fullPath, projectName: displayName } = invokeSessionDriver(
    'claude',
    'sessions',
    'parseRealProjectPath',
    [projectName],
    runtime
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

async function buildCodexPayload(projectName, options = {}, runtime = null) {
  const sessions = await invokeSessionDriver(
    'codex',
    'sessions',
    'listSessions',
    [projectName, indexedReadOptions(options)],
    runtime
  );
  const projectFullPath = sessions.find(session => session.projectFullPath)?.projectFullPath || projectName;

  return {
    sessions,
    totalSize: totalSizeOf(sessions),
    aliases: getAliases(),
    projectInfo: {
      name: projectName,
      fullPath: projectFullPath,
      path: projectFullPath,
      displayName: projectName
    }
  };
}

async function buildGeminiPayload(projectHash, options = {}, runtime = null) {
  const sessions = await invokeSessionDriver(
    'gemini',
    'sessions',
    'listSessions',
    [projectHash, indexedReadOptions(options)],
    runtime
  );
  const realPath = await invokeSessionDriver(
    'gemini',
    'sessions',
    'getProjectPath',
    [projectHash, indexedReadOptions(options)],
    runtime
  );
  const indexedPath = sessions.find(session => session.projectRoot || session.projectFullPath);
  const fullPath = realPath || indexedPath?.projectRoot || indexedPath?.projectFullPath || projectHash;
  const displayName = fullPath !== projectHash ? path.basename(fullPath) : `Project ${projectHash.substring(0, 8)}`;

  return {
    sessions,
    totalSize: totalSizeOf(sessions),
    aliases: getAliases(),
    projectInfo: {
      name: projectHash,
      fullPath,
      path: fullPath,
      displayName
    }
  };
}

async function buildOpenCodePayload(projectName, options = {}, runtime = null) {
  const sessions = await invokeSessionDriver(
    'opencode',
    'sessions',
    'listSessions',
    [projectName, indexedReadOptions(options)],
    runtime
  );
  const projects = await invokeSessionDriver(
    'opencode',
    'sessions',
    'getProjects',
    [indexedReadOptions(options)],
    runtime
  );
  const firstDirectory = sessions.find(session => session.directory)?.directory;
  const project = projects.find(p => p.name === projectName) || null;
  const projectPath = [project?.fullPath, project?.path]
    .find(value => value && value !== '/');
  const fullPath = projectPath || firstDirectory || project?.fullPath || project?.path || projectName;

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

async function buildOmpPayload(projectName, options = {}, runtime = null) {
  const sessions = await invokeSessionDriver(
    'omp',
    'sessions',
    'listSessions',
    [projectName, indexedReadOptions(options)],
    runtime
  );
  const firstDirectory = sessions.find(session => session.directory)?.directory;
  let project = null;
  try {
    project = (await invokeSessionDriver(
      'omp',
      'sessions',
      'getProjects',
      [indexedReadOptions(options)],
      runtime
    )).find(p => p.name === projectName) || null;
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

async function buildPayload({ source, projectName, config, options, runtime }) {
  const snapshotOptions = options || {};
  switch (source) {
    case 'claude':
      return buildClaudePayload(projectName, config || {}, snapshotOptions, runtime);
    case 'codex':
      return buildCodexPayload(projectName, snapshotOptions, runtime);
    case 'gemini':
      return buildGeminiPayload(projectName, snapshotOptions, runtime);
    case 'opencode':
      return buildOpenCodePayload(projectName, snapshotOptions, runtime);
    case 'omp':
      return buildOmpPayload(projectName, snapshotOptions, runtime);
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
