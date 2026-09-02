'use strict';

const implementation = require('./channels-implementation');

function createDriver({ requireImpl, ...context } = {}) {
  const managed = requireImpl
    ? requireImpl('./omp/channels-implementation')
    : implementation;
  return {
    platform: 'omp',
    capability: 'nativeConfig',
    ...context,
    syncManagedProviders: (...args) => managed.syncManagedOmpProviders(...args),
    disableManagedProviders: (...args) => managed.disableManagedOmpProviders(...args),
    isManagedModeEnabled: (...args) => managed.isManagedOmpModeEnabled(...args),
    clearNativeOAuth: () => require('../shared/native-oauth-adapters').clearNativeOAuth('omp')
  };
}

module.exports = { createDriver };
