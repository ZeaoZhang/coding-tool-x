const { createOmpUsageEventCursor } = require('./sessions-implementation');
const { getEnabledChannels } = require('./channels-implementation');
const {
  getManagedProviderId,
  isManagedProviderId,
  normalizeProviderId
} = require('./native-config-implementation');
const { buildSuccessLogPayload, hasMeaningfulUsage } = require('../../../server/services/proxy-log-helper');
const { broadcastLog } = require('../../../server/websocket-server');

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_SEEN_EVENTS = 10000;
let pollTimer = null;
let seenEventKeys = new Set();
let maxSeenEvents = DEFAULT_MAX_SEEN_EVENTS;
let usageEventCursor = null;

function getEventKey(event = {}) {
  return String(event.key || event.id || '').trim();
}

function rememberEventKey(key) {
  if (!key) return;
  if (seenEventKeys.has(key)) {
    seenEventKeys.delete(key);
  }
  seenEventKeys.add(key);
  while (seenEventKeys.size > maxSeenEvents) {
    seenEventKeys.delete(seenEventKeys.values().next().value);
  }
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
  if (!pollTimer) return getOmpSessionLogObserverStatus();

  const events = usageEventCursor.read();
  const channels = getEnabledChannels();
  events.forEach((event) => {
    const key = getEventKey(event);
    if (!key || seenEventKeys.has(key)) return;
    rememberEventKey(key);
    publishEvent(event, channels);
  });
  return getOmpSessionLogObserverStatus();
}

function startOmpSessionLogObserver(options = {}) {
  if (pollTimer) return getOmpSessionLogObserverStatus();

  usageEventCursor = createOmpUsageEventCursor();
  maxSeenEvents = Math.max(1, Number(options.maxSeenEvents) || DEFAULT_MAX_SEEN_EVENTS);
  seenEventKeys = new Set();
  usageEventCursor.read().map(getEventKey).filter(Boolean).forEach(rememberEventKey);
  const intervalMs = Math.max(100, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
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
  return getOmpSessionLogObserverStatus();
}

function stopOmpSessionLogObserver() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = null;
  seenEventKeys = new Set();
  maxSeenEvents = DEFAULT_MAX_SEEN_EVENTS;
  usageEventCursor?.reset?.();
  usageEventCursor = null;
  return getOmpSessionLogObserverStatus();
}

function getOmpSessionLogObserverStatus() {
  return {
    running: Boolean(pollTimer),
    seenEvents: seenEventKeys.size
  };
}

module.exports = {
  startOmpSessionLogObserver,
  stopOmpSessionLogObserver,
  pollOmpSessionLogs,
  getOmpSessionLogObserverStatus,
  _test: {
    resolveChannel
  }
};
