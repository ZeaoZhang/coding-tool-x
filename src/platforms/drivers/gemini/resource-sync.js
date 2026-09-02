'use strict';

const { ok, failed } = require('../../../shared/driver-result');

function createDriver({ requireImpl, ...context } = {}) {
  const moduleExports = requireImpl ? requireImpl('../../server/services/config-sync-manager') : require('../../../server/services/config-sync-manager');
  const manager = typeof moduleExports === 'function' ? new moduleExports() : new moduleExports.ConfigSyncManager();
  const invoke = (operation, args) => {
    try {
      const method = operation === 'sync' ? 'syncToGemini' : 'removeFromGemini';
      const value = manager[method](...args);
      return value && typeof value.then === 'function' ? value.then(data => ok('gemini', 'resourceSync', operation, data)) : ok('gemini', 'resourceSync', operation, value);
    } catch (error) {
      return failed('gemini', 'resourceSync', operation, error);
    }
  };
  return { platform: 'gemini', capability: 'resourceSync', ...context, sync: (...args) => invoke('sync', args), remove: (...args) => invoke('remove', args) };
}

module.exports = { createDriver };
