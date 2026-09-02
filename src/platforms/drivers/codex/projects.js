'use strict';

const { createProjectsDriver } = require('../shared/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'codex',
    servicePath: './codex/sessions-implementation',
    localServicePath: '../codex/sessions-implementation'
  });
}

module.exports = { createDriver };
