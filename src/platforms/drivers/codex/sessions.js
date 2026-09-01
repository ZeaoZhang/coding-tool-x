'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'codex',
    capability: 'sessions',
    servicePath: '../../server/services/codex-sessions',
    localServicePath: '../../../server/services/codex-sessions',
    adapterLocalPath: '../../../server/services/session-history-adapters/codex',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {"listSessions":"getSessionsByProject","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
