'use strict';

const path = require('path');
const { createNativeSnapshotMethods } = require('../native-config-snapshot');
const implementation = require('./channels-implementation');

function createDriver({ requireImpl, ...context } = {}) {
  const configuredPaths = context.pathContext?.native;
  const currentNativePaths = context.pathContext?.customized && configuredPaths?.settings
    ? configuredPaths
    : require('../../../config/paths').NATIVE_PATHS.omp;
  const managed = requireImpl
    ? requireImpl('./omp/channels-implementation')
    : implementation;
  managed.configure?.({ pathContext: context.pathContext });
  const ompDir = currentNativePaths.dir || path.dirname(currentNativePaths.settings);
  const snapshotMethods = createNativeSnapshotMethods({
    settings: { path: currentNativePaths.settings, format: 'yaml' },
    auth: { path: currentNativePaths.auth, format: 'json', mode: 0o600 },
    models: { path: currentNativePaths.models, format: 'yaml' },
    commands: { path: currentNativePaths.commands || path.join(ompDir, 'commands'), format: 'directory' },
    prompts: { path: currentNativePaths.prompts, format: 'directory' },
    skills: { path: currentNativePaths.skills, format: 'directory' },
    extensions: { path: currentNativePaths.extensions, format: 'directory' },
    themes: { path: currentNativePaths.themes || path.join(ompDir, 'themes'), format: 'directory' },
    packages: { path: currentNativePaths.packages || path.join(ompDir, 'packages'), format: 'directory' },
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
    clearNativeOAuth: () => {
      const adapters = require('../../native-oauth-adapters');
      adapters.configure?.(context);
      return adapters.clearNativeOAuth('omp');
    }
  };
}

module.exports = { createDriver };
