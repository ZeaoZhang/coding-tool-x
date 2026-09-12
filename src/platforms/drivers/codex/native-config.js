'use strict';

const fs = require('fs');
const implementation = require('./native-config-implementation');
const { PATHS } = require('../../../config/paths');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');

function createDriver({ requireImpl, ...context } = {}) {
  const currentNativePaths = require('../../../config/paths').NATIVE_PATHS;
  const settings = requireImpl
    ? requireImpl('./codex/native-config-implementation')
    : implementation;
  const snapshotMethods = createNativeSnapshotMethods({
    config: { path: currentNativePaths.codex.config, format: 'text' },
    auth: { path: currentNativePaths.codex.auth, format: 'json', mode: 0o600 }
  }, { platform: 'codex', runtime: context.runtime });
  return {
    platform: 'codex',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    ...snapshotMethods,
    preserveNativeOAuthOnProxyStart: true,
    restoreNativeSettingsOnProxyStop: true,
    clearNativeOAuth: () => require('../../native-oauth-adapters').clearNativeOAuth('codex'),
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
