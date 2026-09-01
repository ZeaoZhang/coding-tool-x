'use strict';

const MODULE_PATHS = Object.freeze({
  claude: Object.freeze({
    projects: '../../server/services/sessions',
    sessions: '../../server/services/sessions',
    proxy: '../../server/proxy-server',
    statistics: '../../server/services/claude-statistics-service',
    nativeConfig: '../../server/services/settings-manager',
    mcp: '../../server/services/mcp-service',
    prompts: '../../server/services/prompts-service'
  }),
  codex: Object.freeze({
    projects: '../../server/services/codex-sessions',
    sessions: '../../server/services/codex-sessions',
    proxy: '../../server/codex-proxy-server',
    statistics: '../../server/services/codex-statistics-service',
    nativeConfig: '../../server/services/codex-settings-manager',
    mcp: '../../server/services/mcp-service',
    prompts: '../../server/services/prompts-service'
  }),
  gemini: Object.freeze({
    projects: '../../server/services/gemini-sessions',
    sessions: '../../server/services/gemini-sessions',
    proxy: '../../server/gemini-proxy-server',
    statistics: '../../server/services/gemini-statistics-service',
    nativeConfig: '../../server/services/gemini-settings-manager',
    mcp: '../../server/services/mcp-service',
    prompts: '../../server/services/prompts-service'
  }),
  opencode: Object.freeze({
    projects: '../../server/services/opencode-sessions',
    sessions: '../../server/services/opencode-sessions',
    proxy: '../../server/opencode-proxy-server',
    statistics: '../../server/services/opencode-statistics-service',
    nativeConfig: '../../server/services/opencode-settings-manager',
    mcp: '../../server/services/mcp-service',
    prompts: '../../server/services/prompts-service'
  }),
  omp: Object.freeze({
    projects: '../../server/services/omp-sessions',
    sessions: '../../server/services/omp-sessions',
    proxy: '../../server/omp-proxy-server',
    statistics: '../../server/services/omp-statistics-service',
    mcp: '../../server/services/mcp-service'
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
  claude: Object.freeze({
    listSessions: 'getSessionsForProject',
    recent: 'getRecentSessions',
    search: 'searchSessions',
    delete: 'deleteSession',
    fork: 'forkSession',
    status: 'getSessionStatus',
    messages: 'getSessionMessages'
  }),
  codex: Object.freeze({
    listSessions: 'getSessionsByProject',
    recent: 'getRecentSessions',
    search: 'searchSessions',
    delete: 'deleteSession',
    fork: 'forkSession',
    status: 'getSessionStatus',
    messages: 'getSessionMessages'
  }),
  gemini: Object.freeze({
    listSessions: 'getProjectSessions',
    recent: 'getRecentSessions',
    search: 'searchSessions',
    delete: 'deleteSession',
    fork: 'forkSession',
    status: 'getSessionStatus',
    messages: 'getSessionMessages'
  }),
  opencode: Object.freeze({
    listSessions: 'getSessionsByProjectId',
    recent: 'getRecentSessions',
    search: 'searchSessions',
    delete: 'deleteSession',
    fork: 'forkSession',
    status: 'getSessionStatus',
    messages: 'getSessionMessages'
  }),
  omp: Object.freeze({
    listSessions: 'getSessionsByProject',
    recent: 'getRecentSessions',
    search: 'searchSessions',
    delete: 'deleteSession',
    fork: 'forkSession',
    status: 'getSessionStatus',
    messages: 'getSessionMessages'
  })
});

const STATISTICS_EXPORTS = Object.freeze({
  summary: Object.freeze(['getStatistics']),
  list: Object.freeze(['getStatistics']),
  daily: Object.freeze(['getDailyStatistics', 'getTodayStatistics']),
  today: Object.freeze(['getTodayStatistics', 'getDailyStatistics']),
  record: Object.freeze(['recordRequest']),
  reset: Object.freeze(['resetStatistics'])
});

const NATIVE_CONFIG_EXPORTS = Object.freeze({
  claude: Object.freeze({
    setProxyConfig: 'setProxyConfig',
    restoreSettings: 'restoreSettings',
    isProxyConfig: 'isProxyConfig',
    settingsExists: 'settingsExists',
    hasBackup: 'hasBackup',
    deleteBackup: 'deleteBackup'
  }),
  codex: Object.freeze({
    setProxyConfig: 'setProxyConfig',
    restoreSettings: 'restoreSettings',
    isProxyConfig: 'isProxyConfig',
    settingsExists: 'settingsExists',
    hasBackup: 'hasBackup',
    deleteBackup: 'deleteBackup'
  }),
  gemini: Object.freeze({
    setProxyConfig: 'setProxyConfig',
    restoreSettings: 'restoreSettings',
    isProxyConfig: 'isProxyConfig',
    settingsExists: 'settingsExists',
    hasBackup: 'hasBackup',
    deleteBackup: 'deleteBackup'
  }),
  opencode: Object.freeze({
    setProxyConfig: 'setProxyConfig',
    restoreSettings: 'restoreSettings',
    isProxyConfig: 'isProxyConfig',
    settingsExists: 'settingsExists',
    hasBackup: 'hasBackup',
    deleteBackup: 'deleteBackup'
  })
});

const RESOURCE_SYNC_METHODS = Object.freeze({
  claude: Object.freeze({ sync: 'syncToClaude', remove: 'removeFromClaude' }),
  codex: Object.freeze({ sync: 'syncToCodex', remove: 'removeFromCodex' }),
  gemini: Object.freeze({ sync: 'syncToGemini', remove: 'removeFromGemini' }),
  opencode: Object.freeze({ sync: 'syncToOpenCode', remove: 'removeFromOpenCode' }),
  omp: Object.freeze({ sync: 'syncToOmp', remove: 'removeFromOmp' })
});

const LEGACY_FILE_EXPORTS = Object.freeze({
  mcp: Object.freeze({
    read: 'readPlatformMcpConfig',
    write: 'writePlatformMcpConfig',
    remove: 'removePlatformMcpServer',
    sync: 'syncPlatformMcpServer',
    import: 'importPlatformMcpServers',
    export: 'exportPlatformMcpServers'
  }),
  prompts: Object.freeze({
    read: 'readLegacyPlatformPrompt',
    write: 'writeLegacyPlatformPrompt',
    remove: 'removeLegacyPlatformPrompt'
  })
});

function createResourceSyncDriver({ platform, capability, requireImpl }) {
  let manager;
  const operations = RESOURCE_SYNC_METHODS[platform];
  const loadManager = () => {
    if (!manager) {
      const service = requireImpl('../../server/services/config-sync-manager');
      manager = new service.ConfigSyncManager();
    }
    return manager;
  };

  return {
    platform,
    capability,
    sync(type, name, sourcePath = null) {
      return operations ? loadManager()[operations.sync](type, name, sourcePath) : unsupported(platform, capability, 'sync');
    },
    remove(type, name) {
      return operations ? loadManager()[operations.remove](type, name) : unsupported(platform, capability, 'remove');
    }
  };
}

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
  const exportNames = Array.isArray(exportName) ? exportName : [exportName];
  for (const name of exportNames) {
    const fn = moduleExports && moduleExports[name];
    if (typeof fn === 'function') return fn(...args);
  }
  return fallback();
}

function createChannelsDriver({ platform, capability, requireImpl, useBuiltInDrivers = requireImpl === require, ...context }) {
  const legacyPaths = {
    claude: '../../server/services/channels',
    codex: '../../server/services/codex-channels',
    gemini: '../../server/services/gemini-channels',
    opencode: '../../server/services/opencode-channels',
    omp: '../../server/services/omp-channels'
  };
  const modulePath = useBuiltInDrivers
    ? `./${platform}/channels`
    : legacyPaths[platform];
  let loaded = false;
  let moduleExports;
  const loadModule = () => {
    if (!loaded) {
      moduleExports = modulePath ? requireImpl(modulePath) : null;
      loaded = true;
    }
    return moduleExports;
  };

  if (useBuiltInDrivers) {
    const driverModule = loadModule();
    if (typeof driverModule?.createDriver === 'function') {
      const builtIn = driverModule.createDriver({ ...context, platform, capability, requireImpl });
      const unwrap = (operation, value) => {
        if (!value || typeof value !== 'object' || typeof value.status !== 'string') return value;
        return value.status === 'ok'
          ? operation === 'list' ? value.data.channels : value.data
          : value;
      };
      const driver = { platform, capability };
      for (const [operation, method] of Object.entries({
        list: 'list',
        create: 'create',
        update: 'update',
        remove: 'remove',
        sync: 'syncCurrent'
      })) {
        driver[operation] = (...args) => {
          const value = builtIn[method](...args);
          return value && typeof value.then === 'function'
            ? value.then(result => unwrap(operation, result))
            : unwrap(operation, value);
        };
      }
      for (const name of Object.keys(builtIn)) {
        if (!(name in driver)) driver[name] = builtIn[name];
      }
      return driver;
    }
  }

  const exportNames = CHANNEL_EXPORTS[platform];
  const driver = { platform, capability };
  driver.list = (...args) => {
    const result = invokeExport(loadModule, exportNames.list, args, () => unsupported(platform, capability, 'list'));
    return platform !== 'claude' && result && Array.isArray(result.channels) ? result.channels : result;
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

function createProxyDriver({ platform, capability, requireImpl, manifest = {} }) {
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

  driver.restoreOnBoot = async ({ config = {} } = {}) => {
    const options = platform === 'omp' ? { preserveStartTime: true } : {};
    const started = await driver.start(options);
    if (started && typeof started.status === 'string' && started.status !== 'ok') {
      return started;
    }
    if (started && started.success === false) {
      return {
        status: 'failed',
        platform,
        capability,
        operation: 'restoreOnBoot',
        error: started.error || 'proxy start failed'
      };
    }

    const port = started?.port
      || (manifest.portKey && config.ports && config.ports[manifest.portKey])
      || manifest.defaultPort
      || null;

    if (platform === 'codex') {
      const settings = requireImpl(MODULE_PATHS.codex.nativeConfig);
      const sync = settings.setProxyConfig(port);
      if (sync && sync.success === false) {
        return {
          status: 'failed',
          platform,
          capability,
          operation: 'restoreOnBoot',
          error: sync.error || 'native config sync failed'
        };
      }
    }

    if (platform === 'opencode') {
      const channelsModule = requireImpl('../../server/services/opencode-channels');
      const proxyModule = loadModule();
      const enabledChannels = typeof channelsModule.getEnabledChannels === 'function'
        ? channelsModule.getEnabledChannels()
        : (channelsModule.getChannels?.().channels || []);
      const allModels = [];
      const seenModels = new Set();
      for (const channel of enabledChannels) {
        for (const model of [channel.model, channel.speedTestModel]) {
          if (typeof model === 'string' && model.trim() && !seenModels.has(model.trim().toLowerCase())) {
            seenModels.add(model.trim().toLowerCase());
            allModels.push(model.trim());
          }
        }
      }
      if (typeof proxyModule?.collectProxyModelList === 'function') {
        const detectedModels = await proxyModule.collectProxyModelList(enabledChannels, { useCacheOnly: true });
        if (Array.isArray(detectedModels)) {
          for (const model of detectedModels) {
            if (typeof model === 'string' && model.trim() && !seenModels.has(model.trim().toLowerCase())) {
              seenModels.add(model.trim().toLowerCase());
              allModels.push(model.trim());
            }
          }
        }
      }
      const firstChannel = enabledChannels[0];
      const sync = requireImpl(MODULE_PATHS.opencode.nativeConfig).setProxyConfig(port, {
        model: firstChannel && (firstChannel.model || firstChannel.speedTestModel) || null,
        models: allModels
      });
      if (sync && sync.success === false) {
        return {
          status: 'failed',
          platform,
          capability,
          operation: 'restoreOnBoot',
          error: sync.error || 'native config sync failed'
        };
      }
    }

    return {
      status: 'ok',
      platform,
      capability,
      operation: 'restoreOnBoot',
      port,
      result: started
    };
  };

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

function createLegacyFileDriver({ platform, capability, requireImpl }) {
  const loadModule = createModuleLoader({ platform, capability, requireImpl });
  const operations = LEGACY_FILE_EXPORTS[capability];
  const driver = { platform, capability };

  for (const [operation, exportName] of Object.entries(operations || {})) {
    driver[operation] = (...args) => invokeExport(
      loadModule,
      exportName,
      [platform, ...args],
      () => unsupported(platform, capability, operation)
    );
  }

  return driver;
}

function createClaudeSessionDriver({ platform, capability, requireImpl }) {
  const loadModule = createModuleLoader({ platform, capability, requireImpl });
  const driver = { platform, capability };
  const adaptArguments = {
    listSessions: (projectName, options = {}) => [options.config || {}, projectName, options],
    recent: (limit, options = {}) => [options.config || {}, limit],
    search: (projectName, keyword, contextLength, options = {}) => [options.config || {}, projectName, keyword, contextLength],
    delete: (projectName, sessionId, options = {}) => [options.config || {}, projectName, sessionId],
    fork: (projectName, sessionId, options = {}) => [options.config || {}, projectName, sessionId, options]
  };
  for (const [operation, exportName] of Object.entries(SESSION_EXPORTS.claude)) {
    driver[operation] = (...args) => invokeExport(
      loadModule,
      exportName,
      adaptArguments[operation] ? adaptArguments[operation](...args) : args,
      () => unsupported(platform, capability, operation)
    );
  }
  return driver;
}

function createProjectsDriver({ platform, capability, requireImpl }) {
  const loadModule = createModuleLoader({ platform, capability, requireImpl });
  const driver = { platform, capability };
  const getClaudeConfig = options => options?.config || {};
  const invokeProjectOperation = (exportName, args, operation = exportName) => invokeExport(
    loadModule,
    exportName,
    args,
    () => unsupported(platform, capability, operation)
  );

  driver.listProjects = options => {
    const normalizedOptions = options || {};
    if (platform === 'claude') {
      const moduleExports = loadModule();
      if (typeof moduleExports?.getProjectsWithStats === 'function') {
        return moduleExports.getProjectsWithStats(getClaudeConfig(normalizedOptions), normalizedOptions);
      }
      return invokeProjectOperation('getProjects', [getClaudeConfig(normalizedOptions)], 'listProjects');
    }
    return invokeProjectOperation('getProjects', [normalizedOptions], 'listProjects');
  };

  if (platform === 'claude') {
    driver.getProjectOrder = options => invokeProjectOperation(
      'getProjectOrder',
      [getClaudeConfig(options)],
      'getProjectOrder'
    );
  }

  driver.getProjectAndSessionCounts = options => {
    const normalizedOptions = options || {};
    return invokeProjectOperation(
      'getProjectAndSessionCounts',
      platform === 'claude' ? [getClaudeConfig(normalizedOptions)] : [normalizedOptions]
    );
  };
  driver.counts = driver.getProjectAndSessionCounts;

  driver.deleteProject = (projectId, options = {}) => invokeProjectOperation(
    'deleteProject',
    platform === 'claude' ? [getClaudeConfig(options), projectId] : [projectId]
  );
  return driver;
}

function createLegacyDriver({ platform, capability, requireImpl = require, manifest = {}, useBuiltInDrivers = false, ...context } = {}) {
  if (capability === 'resourceSync') {
    return createResourceSyncDriver({ platform, capability, requireImpl });
  }
  if ((capability === 'mcp' || capability === 'prompts') && MODULE_PATHS[platform]?.[capability]) {
    return createLegacyFileDriver({ platform, capability, requireImpl });
  }
  if (capability === 'channels') {
    return createChannelsDriver({ ...context, platform, capability, requireImpl, manifest, useBuiltInDrivers });
  }

  if (capability === 'nativeConfig' && useBuiltInDrivers && (platform === 'claude' || platform === 'codex')) {
    const nativeModule = requireImpl(`./${platform}/native-config`);
    if (typeof nativeModule?.createDriver === 'function') {
      return nativeModule.createDriver({ ...context, platform, capability, requireImpl });
    }
  }
  if (capability === 'proxy' && useBuiltInDrivers) {
    const proxyModule = requireImpl(`./${platform}/proxy`);
    if (typeof proxyModule?.createDriver === 'function') {
      const builtIn = proxyModule.createDriver({ ...context, platform, capability, manifest, requireImpl });
      const unwrap = value => value && typeof value === 'object' && value.status === 'ok' ? value.data : value;
      const driver = { platform, capability, restoreOnBoot: builtIn.restoreOnBoot };
      for (const operation of ['status', 'start', 'stop']) {
        driver[operation] = (...args) => {
          const value = builtIn[operation](...args);
          return value && typeof value.then === 'function' ? value.then(unwrap) : unwrap(value);
        };
      }
      for (const name of Object.keys(PROXY_EXPORTS[platform] || {})) {
        driver[PROXY_EXPORTS[platform][name]] = driver[name];
      }
      if (typeof builtIn.handleRequest === 'function') driver.handleRequest = builtIn.handleRequest;
      return driver;
    }
  }

  if (useBuiltInDrivers && (capability === 'sessions' || capability === 'statistics')) {
    const capabilityModule = requireImpl(`./${platform}/${capability}`);
    if (typeof capabilityModule?.createDriver === 'function') {
      return capabilityModule.createDriver({ ...context, platform, capability, requireImpl });
    }
  }

  if (capability === 'proxy') {
    return createProxyDriver({ platform, capability, requireImpl, manifest });
  }
  if (capability === 'projects') {
    return createProjectsDriver({ platform, capability, requireImpl });
  }
  if (capability === 'sessions') {
    return platform === 'claude'
      ? createClaudeSessionDriver({ platform, capability, requireImpl })
      : createMappedDriver({ platform, capability, requireImpl, operations: SESSION_EXPORTS[platform] });
  }
  if (capability === 'statistics') {
    return createMappedDriver({ platform, capability, requireImpl, operations: STATISTICS_EXPORTS });
  }
  if (capability === 'nativeConfig') {
    return createMappedDriver({ platform, capability, requireImpl, operations: NATIVE_CONFIG_EXPORTS[platform] });
  }

  return { status: 'unsupported', platform, capability };
}

function registerLegacyDrivers(driverRegistry, { requireImpl = require } = {}) {
  for (const platform of LEGACY_PLATFORMS) {
    driverRegistry.register(`legacy:${platform}`, context => createLegacyDriver({
      ...context,
      platform,
      requireImpl,
      useBuiltInDrivers: requireImpl === require
    }));
  }
  return driverRegistry;
}

module.exports = {
  MODULE_PATHS,
  createLegacyDriver,
  registerLegacyDrivers
};
