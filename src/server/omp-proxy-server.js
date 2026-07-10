const { loadConfig } = require('../config/loader');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');
const { syncManagedOmpProviders, disableManagedOmpProviders, getEnabledChannels } = require('./services/omp-channels');

let running = false;
let currentPort = null;
let lastSyncResult = null;

async function startOmpProxyServer(options = {}) {
  const preserveStartTime = options.preserveStartTime || false;
  const config = loadConfig();
  currentPort = config.ports?.ompProxy || 20092;
  lastSyncResult = syncManagedOmpProviders();
  running = true;
  saveProxyStartTime('omp', preserveStartTime);
  return {
    success: true,
    port: currentPort,
    sync: lastSyncResult,
    warnings: lastSyncResult?.warnings || []
  };
}

async function stopOmpProxyServer(options = {}) {
  const clearStartTime = options.clearStartTime !== false;
  const stoppedPort = currentPort;
  lastSyncResult = disableManagedOmpProviders();
  running = false;
  currentPort = null;
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

function getOmpProxyStatus() {
  const config = loadConfig();
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
    mode: 'models-yml-provider-config',
    enabledChannelsCount: enabledCount,
    modelsPath: lastSyncResult?.modelsPath || lastSyncResult?.path || null,
    backupPath: lastSyncResult?.backupPath || null,
    modelsValidation: validation,
    warnings: lastSyncResult?.warnings || []
  };
}

module.exports = {
  startOmpProxyServer,
  stopOmpProxyServer,
  getOmpProxyStatus
};
