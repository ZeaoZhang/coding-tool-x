'use strict';

const { ok, unsupported, failed } = require('../../../shared/driver-result');

function createProjectsDriver({ platform, servicePath, localServicePath, requireImpl, ...context } = {}) {
  let service;

  const loadService = () => {
    if (service) return service;
    service = requireImpl ? requireImpl(servicePath) : require(localServicePath);
    return service;
  };

  const configFor = options => platform === 'claude'
    ? options?.config || {}
    : options || {};

  const invoke = (operation, methodName, args) => {
    try {
      const target = loadService();
      if (typeof target?.[methodName] !== 'function') {
        return unsupported(platform, 'projects', operation);
      }
      const value = target[methodName](...args);
      const wrap = result => ok(platform, 'projects', operation, result);
      return value && typeof value.then === 'function'
        ? value.then(wrap).catch(error => failed(platform, 'projects', operation, error))
        : wrap(value);
    } catch (error) {
      return failed(platform, 'projects', operation, error);
    }
  };

  const driver = {
    platform,
    capability: 'projects',
    ...context,
    listProjects(options = {}) {
      const normalizedOptions = options || {};
      try {
        const target = loadService();
        if (platform === 'claude' && typeof target?.getProjectsWithStats === 'function') {
          return invoke('listProjects', 'getProjectsWithStats', [configFor(normalizedOptions), normalizedOptions]);
        }
        return invoke('listProjects', 'getProjects', [configFor(normalizedOptions)]);
      } catch (error) {
        return failed(platform, 'projects', 'listProjects', error);
      }
    },
    getProjectOrder(options = {}) {
      return invoke('getProjectOrder', 'getProjectOrder', [configFor(options)]);
    },
    getProjectAndSessionCounts(options = {}) {
      return invoke('getProjectAndSessionCounts', 'getProjectAndSessionCounts', [configFor(options)]);
    },
    counts(options = {}) {
      return this.getProjectAndSessionCounts(options);
    },
    saveProjectOrder(order, options = {}) {
      const args = platform === 'claude' ? [configFor(options), order] : [order];
      return invoke('saveProjectOrder', 'saveProjectOrder', args);
    },
    deleteProject(projectId, options = {}) {
      const args = platform === 'claude' ? [configFor(options), projectId] : [projectId];
      return invoke('deleteProject', 'deleteProject', args);
    }
  };

  return driver;
}

module.exports = { createProjectsDriver };
