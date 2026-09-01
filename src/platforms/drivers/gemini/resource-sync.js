'use strict';

const { ok, failed } = require('../shared/driver-result');

function createDriver({ requireImpl, ...context } = {}) {
  const moduleExports = requireImpl ? requireImpl('../../server/services/config-sync-manager') : require('../../../server/services/config-sync-manager');
  const manager = typeof moduleExports === 'function' ? new moduleExports() : new moduleExports.ConfigSyncManager();
  const invoke = (operation, args) => {
    try {
      const value = manager[operation === 'sync' ? 'syncToPlatform' : 'removeFromPlatform']('gemini', ...args);
      return value && typeof value.then === 'function' ? value.then(data => ok('gemini', 'resourceSync', operation, data)).catch(error => failed('gemini', 'resourceSync', operation, error)) : ok('gemini', 'resourceSync', operation, value);
    } catch (error) { return failed('gemini', 'resourceSync', operation, error); }
  };
  return { platform: 'gemini', capability: 'resourceSync', ...context, sync: (...args) => invoke('sync', args), remove: (...args) => invoke('remove', args) };
}

module.exports = { createDriver };
