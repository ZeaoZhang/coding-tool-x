'use strict';

const { createProjectsDriver } = require('../../../shared/driver-factories/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'codex',
    servicePath: './codex/sessions-implementation',
    localServicePath: '../../platforms/drivers/codex/sessions-implementation',
    availabilityCheck: () => {
      const config = context.requireImpl
        ? context.requireImpl('./codex/config')
        : require('./config');
      return config.isCodexInstalled();
    },
    onSuccess: operation => {
      if (['saveProjectOrder', 'createProject', 'deleteProject'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('codex');
      }
    }
  });
}

module.exports = { createDriver };
