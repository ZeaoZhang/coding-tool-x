'use strict';

const fs = require('fs');
const claude = require('./claude');
const codex = require('./codex');
const gemini = require('./gemini');
const opencode = require('./opencode');
const omp = require('./omp');

const FACTORIES = { claude, codex, gemini, opencode, omp };

function createProjectConfigAdapters({ registry, fsImpl = fs } = {}) {
  const adapters = new Map();
  const manifests = registry?.list?.({ enabledOnly: true }) || [];

  for (const manifest of manifests) {
    const factory = FACTORIES[manifest.key];
    if (!factory || typeof factory.createAdapter !== 'function') continue;
    adapters.set(manifest.key, factory.createAdapter({ manifest, fsImpl, registry }));
  }

  return adapters;
}

module.exports = { createProjectConfigAdapters };
