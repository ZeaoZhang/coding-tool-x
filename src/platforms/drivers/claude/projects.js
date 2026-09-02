'use strict';

const { createProjectsDriver } = require('../shared/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'claude',
    servicePath: './claude/sessions-implementation',
    localServicePath: '../claude/sessions-implementation'
  });
}

module.exports = { createDriver };
