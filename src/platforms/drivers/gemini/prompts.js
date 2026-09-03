'use strict';

const { createPromptDriver } = require('../shared/prompts');

function createDriver(context = {}) {
  return createPromptDriver({ ...context, platform: 'gemini' });
}

module.exports = { createDriver };
