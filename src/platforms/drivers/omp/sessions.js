'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'omp',
    capability: 'sessions',
    preservePayloadUpdatedAt: true,
    servicePath: './omp/sessions-implementation',
    localServicePath: '../omp/sessions-implementation',
    adapterLocalPath: '../omp/session-history-adapter',
    adapterMethods: { inventory: 'inventory', parse: 'parse' },
    methods: {"listSessions":"getSessionsByProject","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
