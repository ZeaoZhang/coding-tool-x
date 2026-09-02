'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'gemini',
    capability: 'sessions',
    preservePayloadUpdatedAt: true,
    servicePath: './gemini/sessions-implementation',
    localServicePath: '../gemini/sessions-implementation',
    adapterLocalPath: '../gemini/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {"listSessions":"getProjectSessions","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
