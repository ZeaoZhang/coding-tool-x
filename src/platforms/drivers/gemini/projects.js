'use strict';

const { createProjectsDriver } = require('../shared/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'gemini',
    servicePath: './gemini/sessions-implementation',
    localServicePath: '../gemini/sessions-implementation',
    availabilityCheck: () => {
      const config = context.requireImpl
        ? context.requireImpl('./gemini/config')
        : require('./config');
      return config.isGeminiInstalled();
    }
  });
}

module.exports = { createDriver };
