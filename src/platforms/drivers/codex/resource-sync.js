'use strict';

const { ok, failed } = require('../shared/driver-result');

function createDriver({ requireImpl, ...context } = {}) {
  const moduleExports = requireImpl ? requireImpl('../../server/services/config-sync-manager') : require('../../../server/services/config-sync-manager');
  const manager = typeof moduleExports === 'function' ? new moduleExports() : new moduleExports.ConfigSyncManager();
  const invoke = (operation, args) => {
    try {
      const method = operation === 'sync' ? 'syncToCodex' : 'removeFromCodex';
      const value = manager[method](...args);
      return value && typeof value.then === 'function' ? value.then(data => ok('codex', 'resourceSync', operation, data)) : ok('codex', 'resourceSync', operation, value);
    } catch (error) {
      return failed('codex', 'resourceSync', operation, error);
    }
  };
  return { platform: 'codex', capability: 'resourceSync', ...context, sync: (...args) => invoke('sync', args), remove: (...args) => invoke('remove', args) };
}

module.exports = { createDriver };
