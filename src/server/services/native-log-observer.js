'use strict';

const eventBus = require('../../plugins/event-bus');
const { getPlatformRegistry, getPlatformRuntime } = require('../../platforms/runtime');
const { buildSuccessLogPayload, hasMeaningfulUsage, normalizeUsageTokens } = require('./usage-log-utils');
const { broadcastLog } = require('../websocket-server');

const DEFAULT_INTERVAL_MS = 5000;
let pollTimer = null;
let enabled = false;
let intervalMs = DEFAULT_INTERVAL_MS;
let cursors = new Map();
let configSavedListener = null;

function normalizeInterval(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 60
    ? seconds * 1000
    : DEFAULT_INTERVAL_MS;
}

function getStatus() {
  return {
    running: Boolean(pollTimer),
    enabled,
    intervalMs,
    platforms: [...cursors.keys()]
  };
}

function closeCursor(cursor) {
  try { cursor?.close?.(); } catch (_) {}
}

function resolveCursors(runtime = getPlatformRuntime(), registry = getPlatformRegistry()) {
  const next = new Map();
  const platforms = registry.list({ enabledOnly: true });
  for (const platform of platforms) {
    const key = platform.key;
    let driver;
    try { driver = runtime.getDriver(key, 'nativeLogs'); } catch (_) { driver = null; }
    if (!driver || typeof driver.createNativeLogCursor !== 'function') continue;

    const cursor = cursors.get(key) || driver.createNativeLogCursor({});
    if (!cursors.has(key)) {
      try { cursor.initialize?.(); } catch (error) {
        console.warn(`[Native Logs] Failed to initialize ${key}:`, error.message);
      }
    }
    next.set(key, cursor);
  }
  for (const [key, cursor] of cursors) {
    if (!next.has(key)) closeCursor(cursor);
  }
  cursors = next;
}

function recordEvent(platform, event, runtime = getPlatformRuntime()) {
  const timestampValue = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
  const timestamp = Number.isFinite(timestampValue) ? timestampValue : Date.now();
  const tokens = normalizeUsageTokens(platform, event.tokens || event.usage || {});
  if (!hasMeaningfulUsage(platform, tokens)) return false;

  broadcastLog(buildSuccessLogPayload({
    source: platform,
    requestId: event.id,
    channel: event.channel || 'Unknown',
    model: event.model || '',
    tokens,
    cost: Number(event.cost) || 0,
    timestamp,
    usageMissing: false
  }));

  let statistics;
  try { statistics = runtime.getDriver(platform, 'statistics'); } catch (_) { statistics = null; }
  if (statistics && typeof statistics.recordRequest === 'function') {
    statistics.recordRequest({
      id: event.id,
      timestamp: new Date(timestamp).toISOString(),
      session: event.sessionId || null,
      model: event.model || '',
      channel: event.channel,
      channelId: event.channelId,
      tokens,
      cost: Number(event.cost) || 0,
      duration: 0,
      success: true
    });
  }
  return true;
}

function pollNativeCliLogs({ runtime = getPlatformRuntime(), registry = getPlatformRegistry() } = {}) {
  if (!enabled) return getStatus();
  resolveCursors(runtime, registry);
  for (const [platform, cursor] of cursors) {
    try {
      const events = cursor.readNewEvents?.() || cursor.read?.() || [];
      events.forEach(event => recordEvent(platform, event, runtime));
    } catch (error) {
      console.warn(`[Native Logs] Failed to read ${platform}:`, error.message);
    }
  }
  return getStatus();
}

function clearTimer() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startTimer(options) {
  clearTimer();
  pollTimer = setInterval(() => {
    try { pollNativeCliLogs(options); } catch (error) {
      console.warn('[Native Logs] Poll failed:', error.message);
    }
  }, intervalMs);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
}

function ensureConfigListener(options) {
  if (configSavedListener) return;
  configSavedListener = ({ config } = {}) => {
    const next = config?.nativeCliLogs || {};
    configureNativeCliLogObserver({ ...options, enabled: next.enabled, intervalSeconds: next.intervalSeconds });
  };
  eventBus.on('config:saved', configSavedListener);
}

function configureNativeCliLogObserver({
  enabled: nextEnabled = true,
  intervalSeconds = 5,
  runtime = getPlatformRuntime(),
  registry = getPlatformRegistry()
} = {}) {
  ensureConfigListener({ runtime, registry });
  enabled = nextEnabled !== false;
  const nextInterval = normalizeInterval(intervalSeconds);
  const changed = nextInterval !== intervalMs;
  intervalMs = nextInterval;
  if (!enabled) {
    clearTimer();
    for (const cursor of cursors.values()) closeCursor(cursor);
    cursors = new Map();
    return getStatus();
  }
  resolveCursors(runtime, registry);
  if (!pollTimer || changed) startTimer({ runtime, registry });
  return getStatus();
}

function shutdownNativeCliLogObserver() {
  clearTimer();
  for (const cursor of cursors.values()) closeCursor(cursor);
  cursors = new Map();
  enabled = false;
  intervalMs = DEFAULT_INTERVAL_MS;
  if (configSavedListener) {
    eventBus.off('config:saved', configSavedListener);
    configSavedListener = null;
  }
  return getStatus();
}

module.exports = {
  configureNativeCliLogObserver,
  shutdownNativeCliLogObserver,
  pollNativeCliLogs,
  _test: { getStatus, recordEvent, resolveCursors }
};
