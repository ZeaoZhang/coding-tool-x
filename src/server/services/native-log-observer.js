'use strict';

const eventBus = require('../../plugins/event-bus');
const { getPlatformRegistry, getPlatformRuntime } = require('../../platforms/runtime');
const { buildSuccessLogPayload, hasMeaningfulUsage, normalizeUsageTokens } = require('./usage-log-utils');
const { resolveNativeLogChannel, unwrapChannels, isChannelPlaceholder } = require('./native-log-channel-resolver');
const { broadcastLog } = require('../websocket-server');
const { createPersistenceRetryState } = require('./native-log-checkpoints');

const DEFAULT_INTERVAL_MS = 5000;
let pollTimer = null;
let enabled = false;
let intervalMs = DEFAULT_INTERVAL_MS;
let cursors = new Map();
let cursorDiagnostics = new Map();
let pendingEvents = new Map();
let checkpointRetries = new Map();
let firstPollObserved = false;
let configSavedListener = null;
let lifecycleState = 'stopped';
let lastPollEventCount = 0;
let lastPollReadFailed = false;
let drainPromise = null;

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
    hotEntries: Number(details.hotEntries) || 0,
    hotBytes: Number(details.hotBytes) || 0,
    pendingEvents: Number(details.pendingEvents) || 0,
    pendingBytes: Number(details.pendingBytes) || 0,
    fileStates: Number(details.fileStates) || 0,
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
    persistenceBlocked: [...checkpointRetries.values()].some(retry => retry.diagnostics().persistenceBlocked)
      || [...cursors.values()].some(cursor => cursor.diagnostics?.()?.persistenceBlocked),
    intervalMs,
    platforms: [...cursors.keys()],
    pendingEvents: [...pendingEvents.values()].reduce((sum, batch) => sum + batch.length, 0),
    diagnostics: Object.fromEntries([...cursors].map(([key, cursor]) => [key, cursor.diagnostics?.() || cursorDiagnostics.get(key) || {}]))
  };
}

function closeCursor(cursor) {
  try { cursor?.close?.(); } catch (_) {}
}

function resolveCursors(runtime = getPlatformRuntime(), registry = getPlatformRegistry()) {
  const next = new Map();
  const traceEnabled = memoryTraceEnabled();
  const platforms = registry.list({ enabledOnly: true });
  const activePlatforms = new Set();
  for (const platform of platforms) {
    const key = platform.key;
    let driver;
    try { driver = runtime.getDriver(key, 'nativeLogs'); } catch (_) { driver = null; }
    if (!driver || typeof driver.createNativeLogCursor !== 'function') continue;
    activePlatforms.add(key);

    const existing = cursors.get(key);
    let cursor = existing;
    if (!cursor) {
      const retry = checkpointRetries.get(key) || createPersistenceRetryState();
      checkpointRetries.set(key, retry);
      if (!retry.ready()) continue;
      const options = { skipInitialParse: true };
      if (traceEnabled) {
        options.onDiagnostic = details => cursorDiagnostics.set(key, details || {});
      }
      try {
        cursor = driver.createNativeLogCursor(options);
        retry.succeeded();
      } catch (error) {
        retry.failed();
        console.warn(`[Native Logs] Failed to create ${key} checkpoint:`, error.message);
        continue;
      }
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
      pendingEvents.delete(key);
      checkpointRetries.delete(key);
    }
  }
  for (const key of checkpointRetries.keys()) if (!activePlatforms.has(key)) checkpointRetries.delete(key);
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

  let statistics;
  try { statistics = runtime.getDriver(platform, 'statistics'); } catch (_) { statistics = null; }
  if (statistics && typeof statistics.recordRequest === 'function') {
    const accepted = statistics.recordRequest({
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
    if (accepted === false || (accepted && typeof accepted.status === 'string'
      && (accepted.status !== 'ok' || accepted.data === false))) return false;
  }
  broadcastLog(buildSuccessLogPayload({
    source: platform,
    requestId: event.id,
    channel,
    model: event.model || '',
    tokens,
    cacheUsageAvailable: event.cacheUsageAvailable,
    cost: Number(event.cost) || 0,
    timestamp,
    usageMissing: false
  }));
  return true;
}

function pollNativeCliLogs({ runtime = getPlatformRuntime(), registry = getPlatformRegistry(), force = false } = {}) {
  lastPollEventCount = 0;
  lastPollReadFailed = false;
  if (!enabled) return getStatus();
  // A failed statistics spool must stop advancing cursor watermarks.
  const statistics = require('./statistics-service');
  if (statistics.getStatisticsQueueDiagnostics?.().blocked) return getStatus();
  resolveCursors(runtime, registry);
  const channelCache = new Map();
  const traceFirstPoll = memoryTraceEnabled() && !firstPollObserved;
  const orderedCursors = [...cursors].sort(([left], [right]) =>
    Number(pendingEvents.has(right)) - Number(pendingEvents.has(left)));
  for (const [platform, cursor] of orderedCursors) {
    const startedAt = traceFirstPoll ? traceClock() : 0;
    if (traceFirstPoll) traceMemory(platform, 'first-poll-before', cursorDiagnostics.get(platform), 0);
    try {
      const events = pendingEvents.get(platform) || cursor.readNewEvents?.({ force }) || cursor.read?.({ force }) || [];
      lastPollEventCount += events.length;
      pendingEvents.delete(platform);
      for (let index = 0; index < events.length; index++) {
        const event = events[index];
        if (!hasMeaningfulUsage(platform, normalizeUsageTokens(platform, event.tokens || event.usage || {}))) continue;
        try {
          if (recordEvent(platform, event, runtime, channelCache) !== false) continue;
        } catch (error) {
          console.warn(`[Native Logs] Failed to record ${platform}:`, error.message);
        }
        pendingEvents.set(platform, events.slice(index));
        // Do not read another platform while the shared statistics sink is blocked.
        break;
      }
      if (pendingEvents.has(platform)) break;
    } catch (error) {
      lastPollReadFailed = true;
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
  if (lifecycleState === 'draining') return;
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
    if (lifecycleState === 'draining') return;
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
  if (lifecycleState === 'draining') return getStatus();
  ensureConfigListener({ runtime, registry });
  enabled = nextEnabled !== false;
  intervalMs = normalizeInterval(intervalSeconds);
  if (!enabled) {
    clearTimer();
    for (const cursor of cursors.values()) closeCursor(cursor);
    cursors = new Map();
    cursorDiagnostics = new Map();
    pendingEvents = new Map();
    checkpointRetries = new Map();
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
  if (lifecycleState === 'draining') lifecycleState = 'prepared';
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
  if (lifecycleState === 'draining') return getStatus();
  prepareNativeCliLogObserver(options);
  return startNativeCliLogObserver({
    ...options,
    // Preserve the legacy configure() behavior: it starts the interval but
    // does not synchronously consume a new batch of native logs.
    pollImmediately: options.pollImmediately === true
  });
}

function drainNativeCliLogs({ runtime = getPlatformRuntime(), registry = getPlatformRegistry(), maxPasses = 10000 } = {}) {
  if (drainPromise) return drainPromise;
  const previousState = lifecycleState;
  const wasRunning = Boolean(pollTimer);
  clearTimer();
  lifecycleState = 'draining';
  drainPromise = (async () => {
    try {
      const statistics = require('./statistics-service');
      for (let pass = 0; pass < maxPasses; pass++) {
        const result = await statistics.flushStatistics();
        if (result?.error || statistics.getStatisticsQueueDiagnostics?.().blocked) {
          throw new Error(result?.error || 'Native log statistics storage remains blocked');
        }
        pollNativeCliLogs({ runtime, registry, force: true });
        if (pendingEvents.size || getStatus().persistenceBlocked || lastPollReadFailed) {
          throw new Error('Native log drain could not accept its pending batch');
        }
        if (!lastPollEventCount) return getStatus();
      }
      throw new Error('Native log drain did not finish within its batch limit');
    } catch (error) {
      lifecycleState = previousState;
      if (wasRunning) startTimer({ runtime, registry });
      throw error;
    } finally { drainPromise = null; }
  })();
  return drainPromise;
}

function shutdownNativeCliLogObserver() {
  clearTimer();
  for (const cursor of cursors.values()) closeCursor(cursor);
  cursors = new Map();
  cursorDiagnostics = new Map();
  pendingEvents = new Map();
  checkpointRetries = new Map();
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
  getNativeLogDiagnostics: getStatus,
  prepareNativeCliLogObserver,
  startNativeCliLogObserver,
  configureNativeCliLogObserver,
  drainNativeCliLogs,
  shutdownNativeCliLogObserver,
  pollNativeCliLogs,
  _test: { getStatus, recordEvent, resolveCursors, readConfiguredChannels }
};
