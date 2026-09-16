'use strict';

const eventBus = require('../../plugins/event-bus');
const { getPlatformRegistry, getPlatformRuntime } = require('../../platforms/runtime');
const { buildSuccessLogPayload, hasMeaningfulUsage, normalizeUsageTokens } = require('./usage-log-utils');
const { resolveNativeLogChannel, unwrapChannels, isChannelPlaceholder } = require('./native-log-channel-resolver');
const { broadcastLog } = require('../websocket-server');

const DEFAULT_INTERVAL_MS = 5000;
let pollTimer = null;
let enabled = false;
let intervalMs = DEFAULT_INTERVAL_MS;
let cursors = new Map();
let cursorDiagnostics = new Map();
let firstPollObserved = false;
let configSavedListener = null;
let lifecycleState = 'stopped';

function memoryTraceEnabled() {
  return process.env.CC_TOOL_MEMORY_TRACE === '1';
}

function traceMemory(platform, stage, details = {}, durationMs = null) {
  if (!memoryTraceEnabled()) return;
  const usage = process.memoryUsage();
  const payload = {
    pid: process.pid,
    platform,
    stage,
    ...(durationMs === null ? {} : { durationMs: Number(durationMs.toFixed(3)) }),
    files: Number(details.files) || 0,
    bytesRead: Number(details.bytesRead) || 0,
    parsedRecords: Number(details.parsedRecords) || 0,
    maxLineLength: Number(details.maxLineLength) || 0,
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  };
  console.log(`[MEM] native-log ${JSON.stringify(payload)}`);
}

function traceClock() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function normalizeInterval(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 60
    ? seconds * 1000
    : DEFAULT_INTERVAL_MS;
}

function getStatus() {
  return {
    running: Boolean(pollTimer),
    state: lifecycleState,
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
  const traceEnabled = memoryTraceEnabled();
  const platforms = registry.list({ enabledOnly: true });
  for (const platform of platforms) {
    const key = platform.key;
    let driver;
    try { driver = runtime.getDriver(key, 'nativeLogs'); } catch (_) { driver = null; }
    if (!driver || typeof driver.createNativeLogCursor !== 'function') continue;

    const existing = cursors.get(key);
    let cursor = existing;
    if (!cursor) {
      const options = { skipInitialParse: true };
      if (traceEnabled) {
        options.onDiagnostic = details => cursorDiagnostics.set(key, details || {});
      }
      cursor = driver.createNativeLogCursor(options);
      const startedAt = traceClock();
      traceMemory(key, 'cursor-initialize-before', {}, 0);
      try { cursor.initialize?.(); } catch (error) {
        console.warn(`[Native Logs] Failed to initialize ${key}:`, error.message);
      }
      traceMemory(key, 'cursor-initialize-after', cursorDiagnostics.get(key), traceClock() - startedAt);
    }
    next.set(key, cursor);
  }
  for (const [key, cursor] of cursors) {
    if (!next.has(key)) {
      closeCursor(cursor);
      cursorDiagnostics.delete(key);
    }
  }
  cursors = next;
}

function readConfiguredChannels(platform, runtime) {
  let driver;
  try { driver = runtime.getDriver(platform, 'channels'); } catch (_) { driver = null; }
  if (!driver) return [];

  // Read the full list first: a historical event may belong to a channel that
  // was disabled after the CLI emitted the record.
  for (const method of ['list', 'getChannels', 'getEnabled']) {
    if (typeof driver[method] !== 'function') continue;
    try {
      const result = driver[method]();
      if (result && typeof result.then === 'function') continue;
      const channels = unwrapChannels(result);
      if (channels.length) return channels;
    } catch (_) {}
  }
  return [];
}

function recordEvent(platform, event, runtime = getPlatformRuntime(), channelCache = new Map()) {
  const timestampValue = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
  const timestamp = Number.isFinite(timestampValue) ? timestampValue : Date.now();
  const tokens = normalizeUsageTokens(platform, event.tokens || event.usage || {});
  if (!hasMeaningfulUsage(platform, tokens)) return false;
  if (!channelCache.has(platform)) channelCache.set(platform, readConfiguredChannels(platform, runtime));
  const resolvedChannel = resolveNativeLogChannel(event, channelCache.get(platform));
  const channel = resolvedChannel.channel
    || (isChannelPlaceholder(event.channel) ? '' : event.channel)
    || (isChannelPlaceholder(event.provider) ? '' : event.provider)
    || 'Unknown';
  const channelId = resolvedChannel.channelId || event.channelId;

  broadcastLog(buildSuccessLogPayload({
    source: platform,
    requestId: event.id,
    channel,
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
      channel,
      channelId,
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
  const channelCache = new Map();
  const traceFirstPoll = memoryTraceEnabled() && !firstPollObserved;
  for (const [platform, cursor] of cursors) {
    const startedAt = traceFirstPoll ? traceClock() : 0;
    if (traceFirstPoll) traceMemory(platform, 'first-poll-before', cursorDiagnostics.get(platform), 0);
    try {
      const events = cursor.readNewEvents?.() || cursor.read?.() || [];
      events.forEach(event => recordEvent(platform, event, runtime, channelCache));
    } catch (error) {
      console.warn(`[Native Logs] Failed to read ${platform}:`, error.message);
    } finally {
      if (traceFirstPoll) traceMemory(platform, 'first-poll-after', cursorDiagnostics.get(platform), traceClock() - startedAt);
    }
  }
  if (traceFirstPoll) firstPollObserved = true;
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
    const nextOptions = { ...options, enabled: next.enabled, intervalSeconds: next.intervalSeconds };
    if (lifecycleState === 'running') {
      configureNativeCliLogObserver(nextOptions);
    } else {
      prepareNativeCliLogObserver(nextOptions);
    }
  };
  eventBus.on('config:saved', configSavedListener);
}

function prepareNativeCliLogObserver({
  enabled: nextEnabled = true,
  intervalSeconds = 5,
  runtime = getPlatformRuntime(),
  registry = getPlatformRegistry()
} = {}) {
  ensureConfigListener({ runtime, registry });
  enabled = nextEnabled !== false;
  intervalMs = normalizeInterval(intervalSeconds);
  if (!enabled) {
    clearTimer();
    for (const cursor of cursors.values()) closeCursor(cursor);
    cursors = new Map();
    cursorDiagnostics = new Map();
    firstPollObserved = false;
    lifecycleState = 'stopped';
    return getStatus();
  }
  resolveCursors(runtime, registry);
  if (pollTimer) clearTimer();
  lifecycleState = 'prepared';
  return getStatus();
}

function startNativeCliLogObserver({
  runtime = getPlatformRuntime(),
  registry = getPlatformRegistry(),
  pollImmediately = true
} = {}) {
  if (!enabled) return getStatus();
  resolveCursors(runtime, registry);
  if (pollImmediately) {
    try { pollNativeCliLogs({ runtime, registry }); } catch (error) {
      console.warn('[Native Logs] Initial poll failed:', error.message);
    }
  }
  startTimer({ runtime, registry });
  lifecycleState = 'running';
  return getStatus();
}

function configureNativeCliLogObserver(options = {}) {
  prepareNativeCliLogObserver(options);
  return startNativeCliLogObserver({
    ...options,
    // Preserve the legacy configure() behavior: it starts the interval but
    // does not synchronously consume a new batch of native logs.
    pollImmediately: options.pollImmediately === true
  });
}

function shutdownNativeCliLogObserver() {
  clearTimer();
  for (const cursor of cursors.values()) closeCursor(cursor);
  cursors = new Map();
  cursorDiagnostics = new Map();
  firstPollObserved = false;
  enabled = false;
  intervalMs = DEFAULT_INTERVAL_MS;
  lifecycleState = 'stopped';
  if (configSavedListener) {
    eventBus.off('config:saved', configSavedListener);
    configSavedListener = null;
  }
  return getStatus();
}

module.exports = {
  prepareNativeCliLogObserver,
  startNativeCliLogObserver,
  configureNativeCliLogObserver,
  shutdownNativeCliLogObserver,
  pollNativeCliLogs,
  _test: { getStatus, recordEvent, resolveCursors, readConfiguredChannels }
};
