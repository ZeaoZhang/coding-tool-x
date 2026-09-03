'use strict';

const { createProjectsDriver } = require('../shared/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'omp',
    servicePath: './omp/sessions-implementation',
    localServicePath: '../omp/sessions-implementation',
    availabilityMethod: 'isOmpInstalled'
  });
}

module.exports = { createDriver };
