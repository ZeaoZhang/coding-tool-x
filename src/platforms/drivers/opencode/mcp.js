'use strict';
const { createCapabilityDriver } = require('../../../shared/capability-driver');
function createDriver(context = {}) { return createCapabilityDriver({ ...context, platform: 'opencode', capability: 'mcp', servicePath: '../../server/services/mcp-service', localServicePath: '../server/services/mcp-service', methods: { read: 'readPlatformMcpConfig', write: 'writePlatformMcpConfig', remove: 'removePlatformMcpServer', sync: 'syncPlatformMcpServer', import: 'importPlatformMcpServers', export: 'exportPlatformMcpServers' }, prependPlatform: true }); }
module.exports = { createDriver };
