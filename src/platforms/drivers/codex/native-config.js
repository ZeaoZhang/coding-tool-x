'use strict';

const fs = require('fs');
const implementation = require('./native-config-implementation');
const { PATHS } = require('../../../config/paths');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');

function createDriver({ requireImpl, ...context } = {}) {
  const configuredPaths = context.pathContext?.native;
  const currentNativePaths = context.pathContext?.customized && configuredPaths?.config
    ? configuredPaths
    : require('../../../config/paths').NATIVE_PATHS.codex;
  const settings = requireImpl
    ? requireImpl('./codex/native-config-implementation')
    : implementation;
  settings.configure?.({ pathContext: context.pathContext });
  const snapshotMethods = createNativeSnapshotMethods({
    config: { path: currentNativePaths.config, format: 'text' },
    auth: { path: currentNativePaths.auth, format: 'json', mode: 0o600 }
  }, { platform: 'codex', runtime: context.runtime });
  return {
    platform: 'codex',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    ...snapshotMethods,
    preserveNativeOAuthOnProxyStart: true,
    restoreNativeSettingsOnProxyStop: true,
    clearNativeOAuth: () => {
      const adapters = require('../../native-oauth-adapters');
      adapters.configure?.(context);
      return adapters.clearNativeOAuth('codex');
    },
    clearActiveChannelMarker() {
      try {
        const markerPath = context.pathContext?.customized
          ? (context.pathContext.state?.activeChannel || PATHS.activeChannel.codex)
          : PATHS.activeChannel.codex;
        fs.unlinkSync(markerPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  };
}

module.exports = { createDriver };
