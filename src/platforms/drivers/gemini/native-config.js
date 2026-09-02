'use strict';

function createDriver({ requireImpl, ...context } = {}) {
  const settings = requireImpl ? requireImpl('../../server/services/gemini-settings-manager') : require('../../../server/services/gemini-settings-manager');
  return {
    platform: 'gemini', capability: 'nativeConfig', ...context,
    setProxyConfig: (...args) => settings.setProxyConfig(...args),
    restoreSettings: (...args) => settings.restoreSettings(...args),
    isProxyConfig: (...args) => settings.isProxyConfig(...args),
    settingsExists: (...args) => settings.settingsExists(...args),
    hasBackup: (...args) => settings.hasBackup(...args),
    deleteBackup: (...args) => settings.deleteBackup(...args)
  };
}

module.exports = { createDriver };
