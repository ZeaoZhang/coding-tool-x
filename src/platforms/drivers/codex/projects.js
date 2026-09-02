'use strict';

const { createProjectsDriver } = require('../shared/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'codex',
    servicePath: './codex/sessions-implementation',
    localServicePath: '../codex/sessions-implementation',
    availabilityCheck: () => {
      const config = context.requireImpl
        ? context.requireImpl('./codex/config')
        : require('./config');
      return config.isCodexInstalled();
    }
  });
}

module.exports = { createDriver };
