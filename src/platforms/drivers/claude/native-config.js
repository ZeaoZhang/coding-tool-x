'use strict';

const fs = require('fs');
const implementation = require('./native-config-implementation');
const { PATHS } = require('../../../config/paths');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');

function createDriver({ requireImpl, ...context } = {}) {
  const configuredPaths = context.pathContext?.native;
  const currentNativePaths = context.pathContext?.customized && configuredPaths?.settings
    ? configuredPaths
    : require('../../../config/paths').NATIVE_PATHS.claude;
  const settings = requireImpl
    ? requireImpl('./claude/native-config-implementation')
    : implementation;
  settings.configure?.({ pathContext: context.pathContext });
  const snapshotMethods = createNativeSnapshotMethods({
    settings: { path: currentNativePaths.settings, format: 'json' }
  }, { platform: 'claude', runtime: context.runtime });
  return {
    platform: 'claude',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    ...snapshotMethods,
    clearNativeOAuth: () => {
      const adapters = require('../../native-oauth-adapters');
      adapters.configure?.(context);
      return adapters.clearNativeOAuth('claude');
    },
    preserveNativeOAuthOnProxyStart: true,
    restoreNativeSettingsOnProxyStop: true,
    clearActiveChannelMarker() {
      try {
        const markerPath = context.pathContext?.customized
          ? (context.pathContext.state?.activeChannel || PATHS.activeChannel.claude)
          : PATHS.activeChannel.claude;
        fs.unlinkSync(markerPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  };
}

module.exports = { createDriver };
