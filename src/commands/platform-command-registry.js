'use strict';

const { normalizePlatformKey } = require('../shared/platforms');
const platformRuntime = require('../platforms/runtime');

function normalizePlatformDefinition(platform) {
  if (!platform || typeof platform !== 'object' || !platform.key) return null;
  return platform;
}

function createPlatformCommandRegistry({ registry = platformRuntime.getPlatformRegistry(), platforms } = {}) {
  const source = Array.isArray(platforms)
    ? platforms
    : (registry && typeof registry.list === 'function' ? registry.list({ enabledOnly: true }) : []);
  const definitions = new Map(
    source
      .map(normalizePlatformDefinition)
      .filter(Boolean)
      .map(platform => [normalizePlatformKey(platform.key), platform])
  );
  const commands = new Map(
    [...definitions.values()]
      .filter(platform => platform.command)
      .map(platform => [normalizePlatformKey(platform.command), platform])
  );

  const list = () => [...definitions.values()];
  const hasCapability = (platform, capability) => {
    const value = platform?.capabilities?.[capability];
    return value !== undefined && value !== null && value !== 'unsupported';
  };
  return {
    resolve(key) {
      const normalized = normalizePlatformKey(key);
      return definitions.get(normalized) || commands.get(normalized) || null;
    },
    platformKeys() {
      return list().map(platform => platform.key);
    },
    list() {
      return list().map(platform => ({ ...platform }));
    },
    logTypes() {
      return list()
        .filter(platform => platform.logFile || platform.logAliases?.length)
        .map(platform => platform.key);
    },
    portKeys() {
      return list()
        .filter(platform => platform.portKey && platform.defaultPort)
        .map(platform => platform.portKey);
    },
    statsTypes() {
      return list().filter(platform => hasCapability(platform, 'statistics')).map(platform => platform.key);
    },
    selectableTypes() {
      return list()
        .filter(platform => platform.cliSelectable !== false)
        .map(platform => platform.key);
    },
    helpEntries() {
      return list().map(platform => ({
        key: platform.key,
        command: platform.command || platform.key,
        label: platform.helpLabel || platform.label || platform.title || platform.key,
        proxyLabel: platform.proxyLabels?.proxyLabel || '代理',
        proxy: hasCapability(platform, 'proxy'),
        log: Boolean(platform.logFile || platform.logAliases?.length),
        stats: hasCapability(platform, 'statistics'),
        portKey: platform.portKey || null
      }));
    }
  };
}

module.exports = {
  createPlatformCommandRegistry
};
