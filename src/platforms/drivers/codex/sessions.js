'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'codex',
    capability: 'sessions',
    preservePayloadUpdatedAt: true,
    servicePath: './codex/sessions-implementation',
    localServicePath: '../platforms/drivers/codex/sessions-implementation',
    adapterLocalPath: '../platforms/drivers/codex/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {"listSessions":"getSessionsByProject","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
