'use strict';

const { createProjectsDriver } = require('../shared/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'opencode',
    servicePath: './opencode/sessions-implementation',
    localServicePath: '../opencode/sessions-implementation',
    availabilityMethod: 'isOpenCodeInstalled'
  });
}

module.exports = { createDriver };
