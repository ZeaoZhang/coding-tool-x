'use strict';

const MODULE_PATHS = Object.freeze({
  claude: Object.freeze({
    sessions: '../../server/services/sessions',
    channels: '../../server/services/channels',
    proxy: '../../server/proxy-server',
    statistics: '../../server/services/claude-statistics-service'
  }),
  codex: Object.freeze({
    sessions: '../../server/services/codex-sessions',
    channels: '../../server/services/codex-channels',
    proxy: '../../server/codex-proxy-server',
    statistics: '../../server/services/codex-statistics-service'
  }),
  gemini: Object.freeze({
    sessions: '../../server/services/gemini-sessions',
    channels: '../../server/services/gemini-channels',
    proxy: '../../server/gemini-proxy-server',
    statistics: '../../server/services/gemini-statistics-service'
  }),
  opencode: Object.freeze({
    sessions: '../../server/services/opencode-sessions',
    channels: '../../server/services/opencode-channels',
    proxy: '../../server/opencode-proxy-server',
    statistics: '../../server/services/opencode-statistics-service'
  }),
  omp: Object.freeze({
    sessions: '../../server/services/omp-sessions',
    channels: '../../server/services/omp-channels',
    proxy: '../../server/omp-proxy-server',
    statistics: '../../server/services/omp-statistics-service'
  })
});

const LEGACY_PLATFORMS = Object.freeze(Object.keys(MODULE_PATHS));

const CHANNEL_EXPORTS = Object.freeze({
  claude: Object.freeze({
    list: 'getAllChannels',
    create: 'createChannel',
    update: 'updateChannel',
    remove: 'deleteChannel',
    sync: 'syncCurrentClaudeChannel',
    reset: 'resetChannel'
  }),
  codex: Object.freeze({
    list: 'getChannels',
    create: 'createChannel',
    update: 'updateChannel',
    remove: 'deleteChannel',
    sync: 'syncCurrentCodexChannel',
    reset: 'resetChannel'
  }),
  gemini: Object.freeze({
    list: 'getChannels',
    create: 'createChannel',
    update: 'updateChannel',
    remove: 'deleteChannel',
    sync: 'syncCurrentGeminiChannel',
    reset: 'resetChannel'
  }),
  opencode: Object.freeze({
    list: 'getChannels',
    create: 'createChannel',
    update: 'updateChannel',
    remove: 'deleteChannel',
    sync: 'syncCurrentOpenCodeChannel',
    reset: 'resetChannel'
  }),
  omp: Object.freeze({
    list: 'getChannels',
    create: 'createChannel',
    update: 'updateChannel',
    remove: 'deleteChannel',
    sync: 'syncCurrentOmpChannel',
    reset: 'resetChannel'
  })
});

const PROXY_EXPORTS = Object.freeze({
  claude: Object.freeze({
    status: 'getProxyStatus',
    start: 'startProxyServer',
    stop: 'stopProxyServer'
  }),
  codex: Object.freeze({
    status: 'getCodexProxyStatus',
    start: 'startCodexProxyServer',
    stop: 'stopCodexProxyServer'
  }),
  gemini: Object.freeze({
    status: 'getGeminiProxyStatus',
    start: 'startGeminiProxyServer',
    stop: 'stopGeminiProxyServer'
  }),
  opencode: Object.freeze({
    status: 'getOpenCodeProxyStatus',
    start: 'startOpenCodeProxyServer',
    stop: 'stopOpenCodeProxyServer'
  }),
  omp: Object.freeze({
    status: 'getOmpProxyStatus',
    start: 'startOmpProxyServer',
    stop: 'stopOmpProxyServer'
  })
});

const SESSION_EXPORTS = Object.freeze({
  list: 'listSessions',
  recent: 'getRecentSessions',
  search: 'searchSessions',
  messages: 'getSessionMessages',
  status: 'getSessionStatus',
  outline: 'getSessionOutline',
  launch: 'launchSession'
});

const STATISTICS_EXPORTS = Object.freeze({
  summary: 'getStatistics',
  list: 'getStatistics',
  record: 'recordRequest',
  reset: 'resetStatistics'
});

function unsupported(platform, capability, operation) {
  return { status: 'unsupported', platform, capability, operation };
}

function createModuleLoader({ platform, capability, requireImpl }) {
  const modulePath = MODULE_PATHS[platform] && MODULE_PATHS[platform][capability];
  let loaded = false;
  let moduleExports;
  return function loadModule() {
    if (!modulePath) return null;
    if (!loaded) {
      moduleExports = requireImpl(modulePath);
      loaded = true;
    }
    return moduleExports;
  };
}

function invokeExport(loadModule, exportName, args, fallback) {
  const moduleExports = loadModule();
  const fn = moduleExports && moduleExports[exportName];
  if (typeof fn !== 'function') return fallback();
  return fn(...args);
}

function createChannelsDriver({ platform, capability, requireImpl }) {
  const loadModule = createModuleLoader({ platform, capability, requireImpl });
  const exportNames = CHANNEL_EXPORTS[platform];
  const driver = { platform, capability };

  driver.list = (...args) => {
    const result = invokeExport(loadModule, exportNames.list, args, () => unsupported(platform, capability, 'list'));
    return platform === 'claude' ? result : (result && Array.isArray(result.channels) ? result.channels : []);
  };

  for (const operation of ['create', 'update', 'remove', 'sync', 'reset']) {
    driver[operation] = (...args) => invokeExport(
      loadModule,
      exportNames[operation],
      args,
      () => unsupported(platform, capability, operation)
    );
  }

  return driver;
}

function createProxyDriver({ platform, capability, requireImpl }) {
  const loadModule = createModuleLoader({ platform, capability, requireImpl });
  const exportNames = PROXY_EXPORTS[platform];
  const driver = { platform, capability };

  for (const operation of ['status', 'start', 'stop']) {
    driver[operation] = (...args) => invokeExport(
      loadModule,
      exportNames[operation],
      args,
      () => unsupported(platform, capability, operation)
    );
  }

  return driver;
}

function createMappedDriver({ platform, capability, requireImpl, operations }) {
  const loadModule = createModuleLoader({ platform, capability, requireImpl });
  const driver = { platform, capability };

  for (const [operation, exportName] of Object.entries(operations)) {
    driver[operation] = (...args) => invokeExport(
      loadModule,
      exportName,
      args,
      () => unsupported(platform, capability, operation)
    );
  }

  return driver;
}

function createLegacyDriver({ platform, capability, requireImpl = require } = {}) {
  if (!MODULE_PATHS[platform] || !MODULE_PATHS[platform][capability]) {
    return { status: 'unsupported', platform, capability };
  }

  if (capability === 'channels') {
    return createChannelsDriver({ platform, capability, requireImpl });
  }
  if (capability === 'proxy') {
    return createProxyDriver({ platform, capability, requireImpl });
  }
  if (capability === 'sessions') {
    return createMappedDriver({ platform, capability, requireImpl, operations: SESSION_EXPORTS });
  }
  if (capability === 'statistics') {
    return createMappedDriver({ platform, capability, requireImpl, operations: STATISTICS_EXPORTS });
  }

  return { status: 'unsupported', platform, capability };
}

function registerLegacyDrivers(driverRegistry, { requireImpl = require } = {}) {
  for (const platform of LEGACY_PLATFORMS) {
    driverRegistry.register(`legacy:${platform}`, context => createLegacyDriver({
      ...context,
      platform,
      requireImpl
    }));
  }
  return driverRegistry;
}

module.exports = {
  MODULE_PATHS,
  createLegacyDriver,
  registerLegacyDrivers
};
