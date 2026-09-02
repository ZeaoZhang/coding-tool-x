'use strict';

const fs = require('fs');
const { PATHS } = require('../../../config/paths');

function createDriver({ requireImpl, ...context } = {}) {
  const settings = requireImpl ? requireImpl('../../server/services/codex-settings-manager') : require('../../../server/services/codex-settings-manager');
  return {
    platform: 'codex',
    capability: 'nativeConfig',
    ...context,
    setProxyConfig: (...args) => settings.setProxyConfig(...args),
    restoreSettings: (...args) => settings.restoreSettings(...args),
    isProxyConfig: (...args) => settings.isProxyConfig(...args),
    settingsExists: (...args) => settings.settingsExists(...args),
    hasBackup: (...args) => settings.hasBackup(...args),
    deleteBackup: (...args) => settings.deleteBackup(...args),
    clearActiveChannelMarker() {
      try {
        fs.unlinkSync(PATHS.activeChannel.codex);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  };
}

module.exports = { createDriver };
