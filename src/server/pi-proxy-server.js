const { loadConfig } = require('../config/loader');
const { saveProxyStartTime, clearProxyStartTime, getProxyStartTime, getProxyRuntime } = require('./services/proxy-runtime');
const { syncManagedProviderExtension, disableManagedProviderExtension, getEnabledChannels } = require('./services/pi-channels');

let running = false;
let currentPort = null;

async function startPiProxyServer(options = {}) {
  const preserveStartTime = options.preserveStartTime || false;
  const config = loadConfig();
  currentPort = config.ports?.piProxy || 20092;
  syncManagedProviderExtension();
  running = true;
  saveProxyStartTime('pi', preserveStartTime);
  return { success: true, port: currentPort };
}

async function stopPiProxyServer(options = {}) {
  const clearStartTime = options.clearStartTime !== false;
  const stoppedPort = currentPort;
  disableManagedProviderExtension();
  running = false;
  currentPort = null;
  if (clearStartTime) {
    clearProxyStartTime('pi');
  }
  return { success: true, port: stoppedPort };
}

function getPiProxyStatus() {
  const config = loadConfig();
  const startTime = getProxyStartTime('pi', { allowRecovery: running });
  const runtime = getProxyRuntime('pi', { allowRecovery: running });
  const enabledCount = getEnabledChannels().length;
  return {
    running,
    port: currentPort,
    defaultPort: config.ports?.piProxy || 20092,
    startTime,
    runtime,
    mode: 'managed-provider-extension',
    enabledChannelsCount: enabledCount
  };
}

module.exports = {
  startPiProxyServer,
  stopPiProxyServer,
  getPiProxyStatus
};
