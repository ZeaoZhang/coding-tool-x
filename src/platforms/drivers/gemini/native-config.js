'use strict';

const implementation = require('./native-config-implementation');
const path = require('path');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');

function createDriver({ requireImpl, ...context } = {}) {
  const configuredPaths = context.pathContext?.native;
  const currentNativePaths = context.pathContext?.customized && configuredPaths?.env
    ? configuredPaths
    : require('../../../config/paths').NATIVE_PATHS.gemini;
  const settings = requireImpl
    ? requireImpl('./gemini/native-config-implementation')
    : implementation;
  settings.configure?.({ pathContext: context.pathContext });
  const snapshotMethods = createNativeSnapshotMethods({
    env: { path: currentNativePaths.env, format: 'text', mode: 0o600 },
    settings: {
      path: currentNativePaths.settings || path.join(path.dirname(currentNativePaths.env), 'settings.json'),
      format: 'json'
    }
  }, { platform: 'gemini', runtime: context.runtime });
  return {
    platform: 'gemini',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    ...snapshotMethods,
    clearNativeOAuth: () => {
      const adapters = require('../../native-oauth-adapters');
      adapters.configure?.(context);
      return adapters.clearNativeOAuth('gemini');
    },
    preserveNativeOAuthOnProxyStart: true,
    restoreNativeSettingsOnProxyStop: true
  };
}

module.exports = { createDriver };
