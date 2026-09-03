'use strict';

const { createProjectsDriver } = require('../../../shared/driver-factories/projects');

function createDriver(context = {}) {
  return createProjectsDriver({
    ...context,
    platform: 'gemini',
    servicePath: './gemini/sessions-implementation',
    localServicePath: '../../platforms/drivers/gemini/sessions-implementation',
    availabilityCheck: () => {
      const config = context.requireImpl
        ? context.requireImpl('./gemini/config')
        : require('./config');
      return config.isGeminiInstalled();
    },
    onSuccess: operation => {
      if (['saveProjectOrder', 'createProject', 'deleteProject'].includes(operation)) {
        context.sessionHistoryIndex?.invalidateSource('gemini');
      }
    }
  });
}

module.exports = { createDriver };
