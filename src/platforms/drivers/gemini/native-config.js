'use strict';

const implementation = require('./native-config-implementation');
const path = require('path');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');

function createDriver({ requireImpl, ...context } = {}) {
  const currentNativePaths = require('../../../config/paths').NATIVE_PATHS;
  const settings = requireImpl
    ? requireImpl('./gemini/native-config-implementation')
    : implementation;
  const snapshotMethods = createNativeSnapshotMethods({
    env: { path: currentNativePaths.gemini.env, format: 'text', mode: 0o600 },
    settings: {
      path: path.join(path.dirname(currentNativePaths.gemini.env), 'settings.json'),
      format: 'json'
    }
  }, { platform: 'gemini', runtime: context.runtime });
  return {
    platform: 'gemini',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    ...snapshotMethods,
    clearNativeOAuth: () => require('../../native-oauth-adapters').clearNativeOAuth('gemini')
  };
}

module.exports = { createDriver };
