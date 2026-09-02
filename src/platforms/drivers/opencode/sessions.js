'use strict';

const { createCapabilityDriver } = require('../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'opencode',
    capability: 'sessions',
    servicePath: '../../server/services/opencode-sessions',
    localServicePath: '../../../server/services/opencode-sessions',
    methods: {"listSessions":"getSessionsByProjectId","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
