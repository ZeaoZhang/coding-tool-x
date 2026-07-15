'use strict';

const { fork } = require('child_process');

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

async function buildProjectsPayload(source, config = {}, options = {}) {
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
      const projects = getProjects({ force: options.force === true });
      return { projects, currentProject: projects[0] ? projects[0].name : null };
    }
    case 'gemini': {
      const { getProjects } = require('./gemini-sessions');
      const projects = getProjects({ force: options.force === true });
      return { projects, currentProject: projects[0] ? projects[0].name : null };
    }
    case 'opencode': {
      const { getProjects } = require('./opencode-sessions');
      const projects = getProjects({ force: options.force === true });
      return { projects, currentProject: projects[0] ? projects[0].name : null };
    }
    case 'omp': {
      const { getProjects } = require('./omp-sessions');
      const projects = getProjects({ force: options.force === true });
      return { projects, currentProject: projects[0] ? projects[0].name : null };
    }
    default:
      throw new Error(`Unsupported project snapshot source: ${source}`);
  }
}

function buildCountsPayload(source, config = {}, options = {}) {
  switch (source) {
    case 'claude':
      return require('./sessions').getProjectAndSessionCounts(config, { force: options.force === true });
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

function buildTodayStatsPayload(source) {
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

function buildChannelsPayload(source) {
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

async function buildPayload({ kind, source, config, options }) {
  const snapshotOptions = options || {};
  switch (kind) {
    case 'projects':
      return buildProjectsPayload(source, config || {}, snapshotOptions);
    case 'counts':
      return buildCountsPayload(source, config || {}, snapshotOptions);
    case 'todayStats':
      return buildTodayStatsPayload(source);
    case 'channels':
      return buildChannelsPayload(source);
    default:
      throw new Error(`Unsupported dashboard snapshot kind: ${kind}`);
  }
}

function runDashboardSnapshotWorker(kind, source, config = {}, options = {}) {
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve(buildPayload({ kind, source, config, options }));
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
      if (timeout) {
        clearTimeout(timeout);
      }
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

    child.send({ kind, source, config, options });
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
  runDashboardSnapshotWorker
};
