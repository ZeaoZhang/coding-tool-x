'use strict';

const { createProjectsDriver } = require('../../../shared/driver-factories/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'omp',
    servicePath: './omp/sessions-implementation',
    localServicePath: '../../platforms/drivers/omp/sessions-implementation',
    availabilityMethod: 'isOmpInstalled',
    onSuccess: operation => {
      if (['saveProjectOrder', 'createProject', 'deleteProject'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('omp');
      }
    }
  });
}

module.exports = { createDriver };
