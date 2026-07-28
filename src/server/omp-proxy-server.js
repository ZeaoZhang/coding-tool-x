const crypto = require('crypto');
const { loadConfig } = require('../config/loader');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');
const {
  syncManagedOmpProviders,
  disableManagedOmpProviders,
  getEnabledChannels,
  isManagedOmpModeEnabled,
  enableManagedOmpMode,
  disableManagedOmpMode,
  loadManagedOmpActiveChannelId,
  loadManagedOmpModeState
} = require('./services/omp-channels');
const {
  startOmpSessionLogObserver,
  stopOmpSessionLogObserver,
  getOmpSessionLogObserverStatus
} = require('./services/omp-session-log-observer');
const { createOmpGateway } = require('./services/omp-gateway');
const { prepareManagedOmpChannels } = require('./services/omp-gateway-routing');
const { probeOmpAuthGateways } = require('./services/omp-auth-gateway-client');

let currentPort = null;
let lastSyncResult = null;
let lastRoutingResult = { routes: [], unsupportedChannels: [] };
let lifecycle = Promise.resolve();

const gateway = createOmpGateway({
  getChannels: () => getEnabledChannels()
});

function withLifecycleLock(operation) {
  const next = lifecycle.then(operation, operation);
  lifecycle = next.catch(() => {});
  return next;
}

async function startOmpProxyServerUnlocked(options = {}) {
  if (gateway.status().listening) {
    return {
      success: true,
      port: gateway.status().port,
      sync: lastSyncResult,
      warnings: lastSyncResult?.warnings || []
    };
  }
  const preserveStartTime = options.preserveStartTime || false;
  const config = loadConfig();
  const wasEnabled = isManagedOmpModeEnabled();
  const previousState = loadManagedOmpModeState?.() || {
    activeChannelId: loadManagedOmpActiveChannelId()
  };
  const channels = getEnabledChannels();
  const secret = crypto.randomBytes(32).toString('hex');
  const desiredPort = options.port ?? config.ports?.ompProxy ?? 20092;
  const gatewayStatus = await gateway.start({
    host: '127.0.0.1',
    port: desiredPort,
    secret
  });
  currentPort = gatewayStatus.port;
  try {
    const oauthSupport = await probeOmpAuthGateways(channels);
    const descriptor = {
      ...gateway.descriptor(),
      supportedOAuthChannelIds: oauthSupport.supportedOAuthChannelIds
    };
    lastRoutingResult = prepareManagedOmpChannels(channels, descriptor);
    enableManagedOmpMode(options.activeChannelId, descriptor);
    lastSyncResult = syncManagedOmpProviders(channels, {
      gateway: descriptor,
      activeChannelId: options.activeChannelId
    });
    if (oauthSupport.warnings.length > 0) {
      lastSyncResult = {
        ...lastSyncResult,
        warnings: [
          ...(lastSyncResult?.warnings || []),
          ...oauthSupport.warnings
        ]
      };
    }
  } catch (error) {
    if (wasEnabled) {
      enableManagedOmpMode(previousState.activeChannelId, previousState.gateway || null);
    } else {
      disableManagedOmpMode();
    }
    await gateway.stop().catch(() => {});
    currentPort = null;
    throw error;
  }
  startOmpSessionLogObserver();
  saveProxyStartTime('omp', preserveStartTime);
  return {
    success: true,
    port: currentPort,
    sync: lastSyncResult,
    warnings: lastSyncResult?.warnings || []
  };
}

function startOmpProxyServer(options = {}) {
  return withLifecycleLock(() => startOmpProxyServerUnlocked(options));
}

async function stopOmpProxyServerUnlocked(options = {}) {
  const clearStartTime = options.clearStartTime !== false;
  const stoppedPort = currentPort;
  if (!gateway.status().listening && !isManagedOmpModeEnabled()) {
    return {
      success: true,
      port: stoppedPort,
      sync: lastSyncResult,
      warnings: lastSyncResult?.warnings || []
    };
  }
  gateway.beginDraining();
  stopOmpSessionLogObserver();
  try {
    lastSyncResult = disableManagedOmpProviders();
  } catch (error) {
    startOmpSessionLogObserver();
    gateway.cancelDraining();
    throw error;
  }
  disableManagedOmpMode();
  await gateway.stop({ forceAfterMs: options.forceAfterMs });
  currentPort = null;
  lastRoutingResult = { routes: [], unsupportedChannels: [] };
  if (clearStartTime) {
    clearProxyStartTime('omp');
  }
  return {
    success: true,
    port: stoppedPort,
    sync: lastSyncResult,
    warnings: lastSyncResult?.warnings || []
  };
}

function stopOmpProxyServer(options = {}) {
  return withLifecycleLock(() => stopOmpProxyServerUnlocked(options));
}

function getOmpProxyStatus() {
  const config = loadConfig();
  const gatewayStatus = gateway.status();
  const running = gatewayStatus.listening;
  const startTime = getProxyStartTime('omp', { allowRecovery: running });
  const runtime = getProxyRuntime('omp', { allowRecovery: running });
  const enabledCount = getEnabledChannels().length;
  const validation = lastSyncResult?.validation || null;
  return {
    running,
    port: currentPort,
    defaultPort: config.ports?.ompProxy || 20092,
    startTime,
    runtime,
    mode: 'http-gateway',
    listening: gatewayStatus.listening,
    draining: gatewayStatus.draining,
    inflightRequests: gatewayStatus.inflightRequests,
    routingGroups: lastRoutingResult.routes.map(route => ({
      providerKey: route.providerKey,
      providerApi: route.providerApi,
      routingGroup: route.routingGroup,
      managedProviderId: route.managedProviderId,
      channelsCount: route.channelIds.length
    })),
    unsupportedChannels: lastRoutingResult.unsupportedChannels,
    enabledChannelsCount: enabledCount,
    modelsPath: lastSyncResult?.modelsPath || lastSyncResult?.path || null,
    backupPath: lastSyncResult?.backupPath || null,
    modelsValidation: validation,
    sessionLogObserver: getOmpSessionLogObserverStatus(),
    warnings: lastSyncResult?.warnings || []
  };
}

module.exports = {
  startOmpProxyServer,
  stopOmpProxyServer,
  getOmpProxyStatus
};
