'use strict';

const path = require('path');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');
const implementation = require('./channels-implementation');

function createDriver({ requireImpl, ...context } = {}) {
  const currentNativePaths = require('../../../config/paths').NATIVE_PATHS;
  const managed = requireImpl
    ? requireImpl('./omp/channels-implementation')
    : implementation;
  const ompDir = currentNativePaths.omp?.dir || path.dirname(currentNativePaths.omp.settings);
  const snapshotMethods = createNativeSnapshotMethods({
    settings: { path: currentNativePaths.omp.settings, format: 'yaml' },
    auth: { path: currentNativePaths.omp.auth, format: 'json', mode: 0o600 },
    models: { path: currentNativePaths.omp.models, format: 'yaml' },
    commands: { path: currentNativePaths.omp.commands || path.join(ompDir, 'commands'), format: 'directory' },
    prompts: { path: currentNativePaths.omp.prompts, format: 'directory' },
    skills: { path: currentNativePaths.omp.skills, format: 'directory' },
    extensions: { path: currentNativePaths.omp.extensions, format: 'directory' },
    themes: { path: currentNativePaths.omp.themes || path.join(ompDir, 'themes'), format: 'directory' },
    packages: { path: currentNativePaths.omp.packages || path.join(ompDir, 'packages'), format: 'directory' },
    npmPackages: { path: path.join(ompDir, 'npm'), format: 'directory' },
    gitPackages: { path: path.join(ompDir, 'git'), format: 'directory' }
  }, { platform: 'omp', runtime: context.runtime });
  return {
    platform: 'omp',
    capability: 'nativeConfig',
    ...context,
    ...snapshotMethods,
    syncManagedProviders: (...args) => managed.syncManagedOmpProviders(...args),
    disableManagedProviders: (...args) => managed.disableManagedOmpProviders(...args),
    isManagedModeEnabled: (...args) => managed.isManagedOmpModeEnabled(...args),
    clearNativeOAuth: () => require('../../native-oauth-adapters').clearNativeOAuth('omp')
  };
}

module.exports = { createDriver };
