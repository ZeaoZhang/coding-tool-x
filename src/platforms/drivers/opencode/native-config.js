'use strict';

const implementation = require('./native-config-implementation');

function createDriver({ requireImpl, ...context } = {}) {
  const settings = requireImpl
    ? requireImpl('./opencode/native-config-implementation')
    : implementation;
  return {
    platform: 'opencode',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    clearNativeOAuth: () => require('../../native-oauth-adapters').clearNativeOAuth('opencode')
  };
}

module.exports = { createDriver };
