'use strict';

const { createPromptDriver } = require('../shared/prompts');

function createDriver(context = {}) {
  return createPromptDriver({ ...context, platform: 'claude' });
}

module.exports = { createDriver };
