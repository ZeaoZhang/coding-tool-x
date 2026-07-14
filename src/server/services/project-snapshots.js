'use strict';

const {
  getSnapshot,
  invalidateSnapshot
} = require('./snapshot-cache');

const PROJECT_SNAPSHOT_TTL_MS = 60 * 1000;

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
    backgroundOnMiss: !force
  });
}

function invalidateProjectSnapshots(source) {
  invalidateSnapshot(projectListKey(source));
  invalidateSnapshot(projectCountKey(source));
}

module.exports = {
  PROJECT_SNAPSHOT_TTL_MS,
  projectListKey,
  projectCountKey,
  emptyProjectList,
  getProjectListSnapshot,
  invalidateProjectSnapshots
};
