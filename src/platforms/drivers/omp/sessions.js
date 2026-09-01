'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'omp',
    capability: 'sessions',
    servicePath: '../../server/services/omp-sessions',
    localServicePath: '../../../server/services/omp-sessions',
    methods: {"listSessions":"getSessionsByProject","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
