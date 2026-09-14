const { createOmpUsageEventCursor } = require('./sessions-implementation');
const { getEnabledChannels } = require('./channels-implementation');
const {
  getManagedProviderId,
  isManagedProviderId,
  normalizeProviderId
} = require('./native-config-implementation');
const { normalizeNativeCliLogs } = require('../../../config/loader');
const { buildSuccessLogPayload, hasMeaningfulUsage } = require('../../../server/services/proxy-log-helper');
const { broadcastLog } = require('../../../server/websocket-server');
const eventBus = require('../../../plugins/event-bus');

const DEFAULT_INTERVAL_MS = 5000;
let pollTimer = null;
let usageEventCursor = null;
let observerEnabled = false;
let intervalMs = DEFAULT_INTERVAL_MS;
let configSavedListener = null;

function getOmpSessionLogObserverStatus() {
  return {
    running: Boolean(pollTimer),
    enabled: observerEnabled,
    intervalMs,
    cursor: Boolean(usageEventCursor)
  };
}

function resolveChannel(event = {}, channels = getEnabledChannels()) {
  const providerId = normalizeProviderId(event.provider || '');
  const matched = (channels || []).find((channel) => {
    const candidates = [
      getManagedProviderId(channel),
      channel.providerKey,
      channel.provider,
      channel.name,
      channel.id
    ].map(normalizeProviderId);
    return candidates.includes(providerId);
  });

  return {
    id: matched?.id || null,
    name: matched?.name || event.provider || 'OMP'
  };
}

function normalizeTimestamp(value) {
  const timestamp = value ? new Date(value).getTime() : Date.now();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function publishEvent(event, channels) {
  if (isManagedProviderId(normalizeProviderId(event.provider || ''))) {
    return false;
  }
  const channel = resolveChannel(event, channels);
  const usage = event.usage || {};
  broadcastLog(buildSuccessLogPayload({
    source: 'omp',
    requestId: event.id,
    channel: channel.name,
    model: event.model || '',
    tokens: usage,
    cost: Number(usage.cost) || 0,
    timestamp: normalizeTimestamp(event.timestamp),
    usageMissing: !hasMeaningfulUsage('omp', usage)
  }));
  return true;
}

function pollOmpSessionLogs() {
  if (!observerEnabled || !usageEventCursor) return getOmpSessionLogObserverStatus();

  const events = usageEventCursor.read();
  const channels = getEnabledChannels();
  events.forEach((event) => {
    publishEvent(event, channels);
  });
  return getOmpSessionLogObserverStatus();
}

function clearPollTimer() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function resetUsageEventCursor() {
  usageEventCursor?.reset?.();
  usageEventCursor = null;
}

function startPollTimer() {
  clearPollTimer();
  pollTimer = setInterval(() => {
    try {
      pollOmpSessionLogs();
    } catch (error) {
      console.warn('[OMP Sessions] Failed to observe usage logs:', error.message);
    }
  }, intervalMs);
  if (typeof pollTimer.unref === 'function') {
    pollTimer.unref();
  }
}

function createUsageEventCursor() {
  usageEventCursor = createOmpUsageEventCursor();
  try {
    usageEventCursor.read();
  } catch (error) {
    console.warn('[OMP Sessions] Failed to establish usage log baseline:', error.message);
  }
}

function ensureConfigSavedListener() {
  if (configSavedListener) return;
  configSavedListener = ({ config } = {}) => {
    const nativeCliLogs = normalizeNativeCliLogs(config?.nativeCliLogs);
    configureOmpSessionLogObserver({
      enabled: nativeCliLogs.omp.enabled,
      intervalMs: nativeCliLogs.omp.intervalSeconds * 1000
    });
  };
  eventBus.on('config:saved', configSavedListener);
}

function normalizeIntervalMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(100, parsed)
    : DEFAULT_INTERVAL_MS;
}

function configureOmpSessionLogObserver({ enabled = true, intervalMs: nextIntervalMs = DEFAULT_INTERVAL_MS } = {}) {
  ensureConfigSavedListener();

  const nextEnabled = enabled !== false;
  const normalizedIntervalMs = normalizeIntervalMs(nextIntervalMs);
  const wasEnabled = observerEnabled;
  const intervalChanged = normalizedIntervalMs !== intervalMs;
  observerEnabled = nextEnabled;
  intervalMs = normalizedIntervalMs;

  if (!nextEnabled) {
    clearPollTimer();
    resetUsageEventCursor();
    return getOmpSessionLogObserverStatus();
  }

  if (!wasEnabled || !usageEventCursor) {
    createUsageEventCursor();
    startPollTimer();
  } else if (intervalChanged) {
    startPollTimer();
  }
  return getOmpSessionLogObserverStatus();
}

function shutdownOmpSessionLogObserver() {
  clearPollTimer();
  resetUsageEventCursor();
  observerEnabled = false;
  intervalMs = DEFAULT_INTERVAL_MS;
  if (configSavedListener) {
    eventBus.off('config:saved', configSavedListener);
    configSavedListener = null;
  }
  return getOmpSessionLogObserverStatus();
}

module.exports = {
  configureOmpSessionLogObserver,
  shutdownOmpSessionLogObserver,
  pollOmpSessionLogs,
  _test: {
    getOmpSessionLogObserverStatus,
    resolveChannel
  }
};
