'use strict';

const { createNativeSnapshotMethods } = require('./native-config-snapshot');

function createDriver(context = {}) {
  return {
    platform: context.platform,
    capability: 'nativeConfig',
    ...context,
    ...createNativeSnapshotMethods({}, {
      platform: context.platform,
      runtime: context.runtime,
      manifest: context.manifest,
      pathContext: context.pathContext,
      paths: context.paths
    })
  };
}

module.exports = { createDriver };
