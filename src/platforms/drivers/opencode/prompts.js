'use strict';
const { createCapabilityDriver } = require('../shared/capability-driver');
function createDriver(context = {}) { return createCapabilityDriver({ ...context, platform: 'opencode', capability: 'prompts', servicePath: '../../server/services/prompts-service', localServicePath: '../../../server/services/prompts-service', methods: { read: 'readLegacyPlatformPrompt', write: 'writeLegacyPlatformPrompt', remove: 'removeLegacyPlatformPrompt' }, prependPlatform: true }); }
module.exports = { createDriver };
