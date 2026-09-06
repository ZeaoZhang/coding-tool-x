'use strict';

const fs = require('fs');
const implementation = require('./native-config-implementation');
const { PATHS } = require('../../../config/paths');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');

function createDriver({ requireImpl, ...context } = {}) {
  const currentNativePaths = require('../../../config/paths').NATIVE_PATHS;
  const settings = requireImpl
    ? requireImpl('./claude/native-config-implementation')
    : implementation;
  const snapshotMethods = createNativeSnapshotMethods({
    settings: { path: currentNativePaths.claude.settings, format: 'json' }
  }, { platform: 'claude', runtime: context.runtime });
  return {
    platform: 'claude',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    ...snapshotMethods,
    clearNativeOAuth: () => require('../../native-oauth-adapters').clearNativeOAuth('claude'),
    clearActiveChannelMarker() {
      try {
        fs.unlinkSync(PATHS.activeChannel.claude);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  };
}

module.exports = { createDriver };
