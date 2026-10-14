'use strict';

const MIB = 1024 * 1024;
const PAUSE_RSS_BYTES = 380 * MIB;
const RESUME_RSS_BYTES = 330 * MIB;
const CHECK_INTERVAL_MS = 5_000;
let timer = null;
let paused = false;
let lowChecks = 0;
let rejected = 0;
let latestRss = 0;
let persistenceBlocked = false;

function readPersistencePressure() {
  // Admission must not initialize storage or enter the statistics/driver cycle.
  const statistics = require.cache[require.resolve('./statistics-service')]?.exports;
  const nativeLogs = require.cache[require.resolve('./native-log-observer')]?.exports;
  return statistics?.getStatisticsQueueDiagnostics?.().blocked === true
    || nativeLogs?.getNativeLogDiagnostics?.().persistenceBlocked === true;
}

function checkMemoryPressure() {
  latestRss = process.memoryUsage().rss;
  persistenceBlocked = readPersistencePressure();
  if (latestRss >= PAUSE_RSS_BYTES || persistenceBlocked) {
    paused = true;
    lowChecks = 0;
  } else if (paused) {
    lowChecks = latestRss < RESUME_RSS_BYTES ? lowChecks + 1 : 0;
    if (lowChecks >= 2) {
      paused = false;
      lowChecks = 0;
    }
  }
  return getMemoryPressureDiagnostics();
}

function startMemoryPressureMonitor() {
  if (timer) return false;
  checkMemoryPressure();
  timer = setInterval(checkMemoryPressure, CHECK_INTERVAL_MS);
  timer.unref?.();
  return true;
}

function stopMemoryPressureMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
  paused = false;
  lowChecks = 0;
  rejected = 0;
  persistenceBlocked = false;
  latestRss = 0;
}

function isUnderMemoryPressure() {
  startMemoryPressureMonitor();
  // Admission can trip the guard immediately, but only periodic checks recover it.
  latestRss = process.memoryUsage().rss;
  persistenceBlocked = readPersistencePressure();
  if (latestRss >= PAUSE_RSS_BYTES || persistenceBlocked) {
    paused = true;
    lowChecks = 0;
  }
  return paused;
}

function errorBody(platform) {
  const message = 'Server memory pressure; retry in 5 seconds.';
  if (platform === 'claude') return { type: 'error', error: { type: 'overloaded_error', message } };
  if (platform === 'gemini') return { error: { code: 503, status: 'UNAVAILABLE', message } };
  return { error: { type: 'server_error', code: 'memory_pressure', message } };
}

function memoryPressureMiddleware(req, res, next) {
  if (!isUnderMemoryPressure()) return next();
  rejected += 1;
  res.statusCode = 503;
  res.setHeader('Retry-After', '5');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(errorBody(req.proxyPlatform)));
}

function rejectUpgradeUnderPressure(req, socket) {
  if (!isUnderMemoryPressure()) return false;
  rejected += 1;
  const body = JSON.stringify(errorBody(req.proxyPlatform));
  socket.end(`HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  return true;
}

function getMemoryPressureDiagnostics() {
  return { paused, rss: latestRss, lowChecks, rejected, persistenceBlocked };
}

module.exports = {
  memoryPressureMiddleware, rejectUpgradeUnderPressure,
  startMemoryPressureMonitor, stopMemoryPressureMonitor,
  getMemoryPressureDiagnostics,
  _test: { checkMemoryPressure }
};
