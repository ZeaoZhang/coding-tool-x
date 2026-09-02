'use strict';

const express = require('express');

function mountPlatformApi(router, manifest, runtime, config) {
  const platform = String(manifest?.key || '').trim().toLowerCase();
  if (!platform || !manifest?.api?.prefix) return;

  const driver = runtime?.getDriver?.(platform, 'api');
  if (!driver || typeof driver.createRouter !== 'function') return;

  const child = driver.createRouter({ config, manifest });
  if (!child) return;
  router.use(`/${manifest.api.prefix}`, child);

  if (manifest.api.rootAlias) {
    const routes = manifest.api.rootAliasPaths;
    const rootAlias = driver.createRouter({ config, manifest, routes });
    if (rootAlias) router.use('/', rootAlias);
  }
}

function createPlatformApiRouter({ registry, runtime, config } = {}) {
  const router = express.Router();
  const manifests = registry?.list?.({ enabledOnly: true }) || [];

  for (const manifest of manifests) {
    mountPlatformApi(router, manifest, runtime, config, '');
  }

  return router;
}

module.exports = createPlatformApiRouter;
