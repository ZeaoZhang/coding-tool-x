'use strict';

const { createCapabilityDriver } = require('../../../shared/capability-driver');

function createDriver(context = {}) {
  return createCapabilityDriver({
    ...context,
    platform: 'opencode',
    capability: 'sessions',
    servicePath: './opencode/sessions-implementation',
    localServicePath: '../platforms/drivers/opencode/sessions-implementation',
    methods: {"listSessions":"getSessionsByProjectId","recent":"getRecentSessions","search":"searchSessions","delete":"deleteSession","fork":"forkSession","status":"getSessionStatus","messages":"getSessionMessages"}
  });
}

module.exports = { createDriver };
