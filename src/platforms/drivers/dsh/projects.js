'use strict';

const { createDriver: createSessionsDriver } = require('./sessions');

function createDriver(context = {}) {
  const sessions = createSessionsDriver(context);
  const unsupported = operation => () => ({
    status: 'unsupported',
    platform: 'dsh',
    capability: 'projects',
    operation
  });
  return {
    platform: 'dsh',
    capability: 'projects',
    listProjects: sessions.listProjects,
    listProjectsPage: sessions.listProjectsPage,
    saveProjectOrder: unsupported('saveProjectOrder'),
    deleteProject: unsupported('deleteProject')
  };
}

module.exports = { createDriver };
