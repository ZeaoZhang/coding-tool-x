'use strict';

const implementation = require('./native-config-implementation');

function createDriver({ requireImpl, ...context } = {}) {
  const settings = requireImpl
    ? requireImpl('./gemini/native-config-implementation')
    : implementation;
  return {
    platform: 'gemini',
    capability: 'nativeConfig',
    ...context,
    ...settings,
    clearNativeOAuth: () => require('../shared/native-oauth-adapters').clearNativeOAuth('gemini')
  };
}

module.exports = { createDriver };
