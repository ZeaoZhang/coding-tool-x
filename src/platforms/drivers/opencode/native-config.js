'use strict';

const implementation = require('./native-config-implementation');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');

function createDriver({ requireImpl, ...context } = {}) {
  const settings = requireImpl
    ? requireImpl('./opencode/native-config-implementation')
    : implementation;
  const configPaths = settings.CONFIG_PATHS || {};
  const snapshotMethods = createNativeSnapshotMethods({
    opencodeJsonc: { path: configPaths.opencodec, format: 'text' },
    opencodeJson: { path: configPaths.opencode, format: 'text' },
    configJson: { path: configPaths.config, format: 'text' }
  }, { platform: 'opencode', runtime: context.runtime });
  return {
    platform: 'opencode',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    ...snapshotMethods,
    clearNativeOAuth: () => require('../../native-oauth-adapters').clearNativeOAuth('opencode')
  };
}

module.exports = { createDriver };
