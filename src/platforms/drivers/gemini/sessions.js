'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'gemini',
    capability: 'sessions',
    servicePath: '../../server/services/gemini-sessions',
    localServicePath: '../../../server/services/gemini-sessions',
    adapterLocalPath: '../../../server/services/session-history-adapters/gemini',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {"listSessions":"getProjectSessions","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
