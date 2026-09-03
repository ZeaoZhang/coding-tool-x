'use strict';

const express = require('express');
const createPlatformRouteFactory = require('./platform-route-factory');


function mountPlatformApi(router, manifest, factory) {
  if (!manifest?.api?.prefix) return;
  factory.mount(router, { manifest, basePath: `/${manifest.api.prefix}` });
  if (manifest.api.rootAlias) factory.mount(router, { manifest, basePath: '/', aliases: true });
}

function createPlatformApiRouter({ registry, runtime, config } = {}) {
  const router = express.Router();
  const factory = createPlatformRouteFactory({ registry, runtime, config });
  const manifests = registry?.list?.({ enabledOnly: true }) || [];

  for (const manifest of manifests) {
    mountPlatformApi(router, manifest, factory);
  }

  return router;
}

module.exports = createPlatformApiRouter;
module.exports.mountPlatformApi = mountPlatformApi;
