'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'claude',
    capability: 'sessions',
    preservePayloadUpdatedAt: true,
    servicePath: './claude/sessions-implementation',
    localServicePath: '../platforms/drivers/claude/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/claude/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {"listSessions":"getSessionsForProject","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
