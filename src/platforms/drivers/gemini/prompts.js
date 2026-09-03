'use strict';

const { createPromptDriver } = require('../../../shared/driver-factories/prompts');

function createDriver(context = {}) {
  return createPromptDriver({ ...context, platform: 'gemini' });
}

module.exports = { createDriver };
