'use strict';

const { createProjectsDriver } = require('../shared/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'gemini',
    servicePath: './gemini/sessions-implementation',
    localServicePath: '../gemini/sessions-implementation'
  });
}

module.exports = { createDriver };
