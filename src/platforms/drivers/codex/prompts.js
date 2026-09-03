'use strict';

const { createPromptDriver } = require('../../../shared/driver-factories/prompts');

function createDriver(context = {}) {
  return createPromptDriver({ ...context, platform: 'codex' });
}

module.exports = { createDriver };
