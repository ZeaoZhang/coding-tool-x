'use strict';

const {
  getSnapshot,
  invalidateSnapshot,
  invalidateDashboardSourceSnapshot
} = require('./snapshot-cache');

const PROJECT_SNAPSHOT_TTL_MS = 60 * 1000;
const PROJECT_SNAPSHOT_WAIT_ON_MISS_MS = process.env.NODE_ENV === 'test' ? 0 : 1500;
const PROJECT_SNAPSHOT_WAIT_ON_FORCE_MS = process.env.NODE_ENV === 'test' ? 0 : 1500;

function projectListKey(source) {
  return `projects:list:${source}`;
}

function projectCountKey(source) {
  return `dashboard:counts:${source}`;
}

function emptyProjectList(currentProject = null, extra = {}) {
  return {
    projects: [],
    currentProject,
    ...extra
  };
}

async function getProjectListSnapshot(source, {
  fallbackValue,
  refresh,
  force = false
}) {
  return getSnapshot(projectListKey(source), {
    ttlMs: PROJECT_SNAPSHOT_TTL_MS,
    fallbackValue,
    refresh,
    force,
    backgroundOnMiss: !force,
    staleWhileForce: true,
    waitOnMissMs: PROJECT_SNAPSHOT_WAIT_ON_MISS_MS,
    waitOnForceMs: PROJECT_SNAPSHOT_WAIT_ON_FORCE_MS
  });
}
function invalidateProjectSnapshots(source) {
  invalidateSnapshot(projectListKey(source));
  invalidateSnapshot(projectCountKey(source));
  invalidateDashboardSourceSnapshot(source);
}

module.exports = {
  PROJECT_SNAPSHOT_TTL_MS,
  PROJECT_SNAPSHOT_WAIT_ON_MISS_MS,
  PROJECT_SNAPSHOT_WAIT_ON_FORCE_MS,
  projectListKey,
  projectCountKey,
  emptyProjectList,
  getProjectListSnapshot,
  invalidateProjectSnapshots
};
