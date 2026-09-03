'use strict';

const fs = require('fs');
const implementation = require('./native-config-implementation');
const { PATHS } = require('../../../config/paths');

function createDriver({ requireImpl, ...context } = {}) {
  const settings = requireImpl
    ? requireImpl('./claude/native-config-implementation')
    : implementation;
  return {
    platform: 'claude',
    capability: 'nativeConfig',
    ...context,
    ...settings,
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
