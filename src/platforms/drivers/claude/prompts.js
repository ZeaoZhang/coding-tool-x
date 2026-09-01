'use strict';
const { createCapabilityDriver } = require('../shared/capability-driver');
function createDriver(context = {}) { return createCapabilityDriver({ ...context, platform: 'claude', capability: 'prompts', servicePath: '../../server/services/prompts-service', localServicePath: '../../../server/services/prompts-service', methods: { read: 'readPlatformPrompt', write: 'writePlatformPrompt', remove: 'removePlatformPrompt' }, prependPlatform: true }); }
module.exports = { createDriver };
