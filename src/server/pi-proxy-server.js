const { loadConfig } = require('../config/loader');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');
const { syncManagedOmpProviders, disableManagedOmpProviders, getEnabledChannels } = require('./services/pi-channels');

let running = false;
let currentPort = null;
let lastSyncResult = null;

async function startPiProxyServer(options = {}) {
  const preserveStartTime = options.preserveStartTime || false;
  const config = loadConfig();
  currentPort = config.ports?.piProxy || 20092;
  lastSyncResult = syncManagedOmpProviders();
  running = true;
  saveProxyStartTime('pi', preserveStartTime);
  return {
    success: true,
    port: currentPort,
    sync: lastSyncResult,
    warnings: lastSyncResult?.warnings || []
  };
}

async function stopPiProxyServer(options = {}) {
  const clearStartTime = options.clearStartTime !== false;
  const stoppedPort = currentPort;
  lastSyncResult = disableManagedOmpProviders();
  running = false;
  currentPort = null;
  if (clearStartTime) {
    clearProxyStartTime('pi');
  }
  return {
    success: true,
    port: stoppedPort,
    sync: lastSyncResult,
    warnings: lastSyncResult?.warnings || []
  };
}

function getPiProxyStatus() {
  const config = loadConfig();
  const startTime = getProxyStartTime('pi', { allowRecovery: running });
  const runtime = getProxyRuntime('pi', { allowRecovery: running });
  const enabledCount = getEnabledChannels().length;
  const validation = lastSyncResult?.validation || null;
  return {
    running,
    port: currentPort,
    defaultPort: config.ports?.piProxy || 20092,
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
  startPiProxyServer,
  stopPiProxyServer,
  getPiProxyStatus
};
