'use strict';

const fs = require('fs');
const implementation = require('./native-config-implementation');
const { PATHS } = require('../../../config/paths');

function createDriver({ requireImpl, ...context } = {}) {
  const settings = requireImpl
    ? requireImpl('./codex/native-config-implementation')
    : implementation;
  return {
    platform: 'codex',
    capability: 'nativeConfig',
    ...context,
    ...settings,
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
