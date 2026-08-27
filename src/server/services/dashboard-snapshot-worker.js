'use strict';

const { fork } = require('child_process');
const platformRuntime = require('../../platforms/runtime');

const DASHBOARD_SNAPSHOT_WORKER_TIMEOUT_MS = 180 * 1000;

function sortClaudeProjects(projects, order = []) {
  if (!Array.isArray(order) || order.length === 0) {
    return projects;
  }
  const orderMap = new Map(order.map((name, idx) => [name, idx]));
  return [...projects].sort((a, b) => {
    const aIdx = orderMap.has(a.name) ? orderMap.get(a.name) : 999999;
    const bIdx = orderMap.has(b.name) ? orderMap.get(b.name) : 999999;
    if (aIdx === bIdx) {
      return (b.lastUsed || 0) - (a.lastUsed || 0);
    }
    return aIdx - bIdx;
  });
}

function _getRuntimeDriver(runtime, source, capability) {
  if (!runtime || typeof runtime.getDriver !== 'function') {
    return null;
  }
  try {
    return runtime.getDriver(source, capability);
  } catch (_) {
    return null;
  }
}

function _getProjectsGetter(driver) {
  if (!driver) return null;
  if (typeof driver.listProjects === 'function') return driver.listProjects.bind(driver);
  if (typeof driver.getProjects === 'function') return driver.getProjects.bind(driver);
  return null;
}

function _getProjectOrderGetter(driver) {
  if (!driver || typeof driver.getProjectOrder !== 'function') return null;
  return driver.getProjectOrder.bind(driver);
}

async function _getClaudeProjectOrder(driver, config, options) {
  const getter = _getProjectOrderGetter(driver);
  if (getter) {
    return getter({ force: options.force === true, config });
  }
  return config.projectOrder || config.order || [];
}


function _getCountsGetter(driver) {
  if (!driver) return null;
  if (typeof driver.getProjectAndSessionCounts === 'function') return driver.getProjectAndSessionCounts.bind(driver);
  if (typeof driver.counts === 'function') return driver.counts.bind(driver);
  return null;
}

function _getTodayStatsGetter(driver) {
  if (!driver) return null;
  if (typeof driver.getTodayStatistics === 'function') return driver.getTodayStatistics.bind(driver);
  if (typeof driver.today === 'function') return driver.today.bind(driver);
  return null;
}

function _getChannelsGetter(driver) {
  if (!driver) return null;
  if (typeof driver.list === 'function') return driver.list.bind(driver);
  if (typeof driver.getChannels === 'function') return driver.getChannels.bind(driver);
  return null;
}

function _normalizeProjectPayload(source, projects, config = {}) {
  if (Array.isArray(projects)) {
    const ordered = source === 'claude'
      ? sortClaudeProjects(projects, config.projectOrder || config.order || [])
      : projects;

    return {
      projects: ordered,
      currentProject: config.currentProject || (ordered[0] ? ordered[0].name : null)
    };
  }

  if (projects && typeof projects === 'object' && Array.isArray(projects.projects)) {
    const ordered = source === 'claude'
      ? sortClaudeProjects(projects.projects, config.projectOrder || config.order || [])
      : projects.projects;
    const hasExplicitCurrentProject = Object.prototype.hasOwnProperty.call(projects, 'currentProject');

    return {
      projects: ordered,
      currentProject: hasExplicitCurrentProject
        ? projects.currentProject
        : (config.currentProject || (ordered[0] ? ordered[0].name : null))
    };
  }

  return projects;
}

function _normalizeChannelsPayload(source, value) {
  if (source === 'claude') {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && Array.isArray(value.channels)) {
      return value.channels;
    }
    return [];
  }

  if (Array.isArray(value)) {
    return { channels: value };
  }
  if (value && typeof value === 'object' && Array.isArray(value.channels)) {
    return value;
  }
  if (value == null) {
    return { channels: [] };
  }
  return value;
}

async function buildProjectsPayload(source, config = {}, options = {}) {
  const runtime = options.runtime || platformRuntime.getPlatformRuntime();
  const driver = _getRuntimeDriver(runtime, source, 'projects');
  const getter = _getProjectsGetter(driver);
  if (getter) {
    const driverOptions = { force: options.force === true, config };
    const projects = await getter(driverOptions);
    if (source === 'claude') {
      const order = await _getClaudeProjectOrder(driver, config, options);
      return _normalizeProjectPayload(source, projects, { projectOrder: order, currentProject: config.currentProject });
    }
    return _normalizeProjectPayload(source, projects, config);
  }

  switch (source) {
    case 'claude': {
      const { getProjectsWithStats, getProjectOrder } = require('./sessions');
      const projects = await getProjectsWithStats(config, { force: options.force === true });
      const sortedProjects = sortClaudeProjects(projects, getProjectOrder(config));
      return {
        projects: sortedProjects,
        currentProject: config.currentProject || (sortedProjects[0] ? sortedProjects[0].name : null)
      };
    }
    case 'codex': {
      const { getProjects } = require('./codex-sessions');
      const projects = await getProjects({ force: options.force === true });
      return { projects, currentProject: projects[0] ? projects[0].name : null };
    }
    case 'gemini': {
      const { getProjects } = require('./gemini-sessions');
      const projects = await getProjects({ force: options.force === true });
      return { projects, currentProject: projects[0] ? projects[0].name : null };
    }
    case 'opencode': {
      const { getProjects } = require('./opencode-sessions');
      const projects = getProjects({ force: options.force === true });
      return { projects, currentProject: projects[0] ? projects[0].name : null };
    }
    case 'omp': {
      const { getProjects } = require('./omp-sessions');
      const projects = await getProjects({ force: options.force === true });
      return { projects, currentProject: projects[0] ? projects[0].name : null };
    }
    default:
      throw new Error(`Unsupported project snapshot source: ${source}`);
  }
}

async function buildCountsPayload(source, config = {}, options = {}) {
  const runtime = options.runtime || platformRuntime.getPlatformRuntime();
  const driver = _getRuntimeDriver(runtime, source, 'projects');
  const getter = _getCountsGetter(driver);
  if (getter) {
    return getter({ force: options.force === true, config });
  }

  switch (source) {
    case 'claude':
      return require('./sessions').getProjectAndSessionCounts(config);
    case 'codex':
      return require('./codex-sessions').getProjectAndSessionCounts({ force: options.force === true });
    case 'gemini':
      return require('./gemini-sessions').getProjectAndSessionCounts({ force: options.force === true });
    case 'opencode':
      return require('./opencode-sessions').getProjectAndSessionCounts({ force: options.force === true });
    case 'omp':
      return require('./omp-sessions').getProjectAndSessionCounts({ force: options.force === true });
    default:
      throw new Error(`Unsupported counts snapshot source: ${source}`);
  }
}

async function buildTodayStatsPayload(source, config = {}, options = {}) {
  const runtime = options.runtime || platformRuntime.getPlatformRuntime();
  const driver = _getRuntimeDriver(runtime, source, 'statistics');
  const getter = _getTodayStatsGetter(driver);
  if (getter) {
    return getter({ force: options.force === true, config });
  }

  switch (source) {
    case 'claude':
      return require('./claude-statistics-service').getTodayStatistics();
    case 'codex':
      return require('./codex-statistics-service').getTodayStatistics();
    case 'gemini':
      return require('./gemini-statistics-service').getTodayStatistics();
    case 'opencode':
      return require('./opencode-statistics-service').getTodayStatistics();
    case 'omp':
      return require('./omp-statistics-service').getTodayStatistics();
    default:
      throw new Error(`Unsupported today stats snapshot source: ${source}`);
  }
}

async function buildChannelsPayload(source, config = {}, options = {}) {
  const runtime = options.runtime || platformRuntime.getPlatformRuntime();
  const driver = _getRuntimeDriver(runtime, source, 'channels');
  const getter = _getChannelsGetter(driver);
  if (getter) {
    const value = await getter({ force: options.force === true, config });
    return _normalizeChannelsPayload(source, value);
  }

  switch (source) {
    case 'claude':
      return require('./channels').getAllChannels();
    case 'codex':
      return require('./codex-channels').getChannels();
    case 'gemini':
      return require('./gemini-channels').getChannels();
    case 'opencode':
      return require('./opencode-channels').getChannels();
    case 'omp':
      return require('./omp-channels').getChannels();
    default:
      throw new Error(`Unsupported channels snapshot source: ${source}`);
  }
}

async function buildPayload({ kind, source, config, options, runtime } = {}) {
  const snapshotOptions = options || {};
  const effectiveOptions = runtime ? { ...snapshotOptions, runtime } : snapshotOptions;
  switch (kind) {
    case 'projects':
      return buildProjectsPayload(source, config || {}, effectiveOptions);
    case 'counts':
      return buildCountsPayload(source, config || {}, effectiveOptions);
    case 'todayStats':
      return buildTodayStatsPayload(source, config || {}, effectiveOptions);
    case 'channels':
      return buildChannelsPayload(source, config || {}, effectiveOptions);
    default:
      throw new Error(`Unsupported dashboard snapshot kind: ${kind}`);
  }
}

function _getSerializableWorkerOptions(options = {}) {
  if (!options || typeof options !== 'object') {
    return {};
  }
  const { runtime: _runtime, ...serializableOptions } = options;
  return serializableOptions;
}

function runDashboardSnapshotWorker(kind, source, config = {}, options = {}) {
  const workerOptions = _getSerializableWorkerOptions(options);

  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve(buildPayload({ kind, source, config, options: workerOptions }));
  }

  return new Promise((resolve, reject) => {
    const child = fork(__filename, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
      env: {
        ...process.env,
        CC_TOOL_DASHBOARD_SNAPSHOT_WORKER: '1'
      }
    });

    let settled = false;
    let stderr = '';
    let timeout = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners();
      if (!child.killed) {
        child.kill();
      }
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };


    timeout = setTimeout(() => {
      finish(new Error(`Dashboard snapshot refresh timed out for ${kind}/${source}`));
    }, DASHBOARD_SNAPSHOT_WORKER_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096);
      }
    });

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.ok) {
        finish(null, message.value);
      } else {
        finish(new Error(message.error || `Dashboard snapshot refresh failed for ${kind}/${source}`));
      }
    });

    child.on('error', (error) => finish(error));
    child.on('exit', (code, signal) => {
      if (settled) return;
      const suffix = stderr ? `: ${stderr.trim()}` : '';
      finish(new Error(`Dashboard snapshot worker exited (${code || signal || 'unknown'})${suffix}`));
    });

    child.send({ kind, source, config, options: workerOptions });
  });
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

if (process.env.CC_TOOL_DASHBOARD_SNAPSHOT_WORKER === '1' || require.main === module) {
  attachWorkerHandler();
}

module.exports = {
  buildPayload,
  runDashboardSnapshotWorker,
  _test: {
    getSerializableWorkerOptions: _getSerializableWorkerOptions
  }
};
