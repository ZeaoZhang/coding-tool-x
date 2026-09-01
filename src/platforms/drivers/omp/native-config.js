'use strict';

function createDriver({ requireImpl, ...context } = {}) {
  const service = requireImpl ? requireImpl('../../server/services/omp-channels') : require('../../../server/services/omp-channels');
  return {
    platform: 'omp', capability: 'nativeConfig', ...context,
    syncManagedProviders: (...args) => service.syncManagedOmpProviders(...args),
    disableManagedProviders: (...args) => service.disableManagedOmpProviders(...args),
    isManagedModeEnabled: (...args) => service.isManagedOmpModeEnabled(...args)
  };
}

module.exports = { createDriver };
