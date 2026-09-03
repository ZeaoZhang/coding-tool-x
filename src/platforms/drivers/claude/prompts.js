'use strict';

const { createPromptDriver } = require('../../../shared/driver-factories/prompts');

function createDriver(context = {}) {
  return createPromptDriver({ ...context, platform: 'claude' });
}

module.exports = { createDriver };
