'use strict';

const { createProjectsDriver } = require('../../../shared/driver-factories/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'opencode',
    servicePath: './opencode/sessions-implementation',
    localServicePath: '../../platforms/drivers/opencode/sessions-implementation',
    availabilityMethod: 'isOpenCodeInstalled',
    onSuccess: operation => {
      if (['saveProjectOrder', 'createProject', 'deleteProject'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('opencode');
      }
    }
  });
}

module.exports = { createDriver };
