'use strict';

const MIB = 1024 * 1024;
const CHECK_INTERVAL_MS = 5_000;
const MIN_IDLE_MS = 30_000;
const GC_COOLDOWN_MS = 5 * 60_000;
const RSS_PRESSURE_BYTES = 380 * MIB;
const HEAP_PRESSURE_BYTES = 256 * MIB;
const URGENT_RSS_BYTES = 450 * MIB;
const URGENT_GC_COOLDOWN_MS = 30_000;

let timer = null;
let activeRequests = 0;
let lastActivityAt = Date.now();
let lastCollectionAt = 0;

function trackMemoryActivity(_req, res, next) {
  if (typeof global.gc !== 'function') {
    if (typeof next === 'function') next();
    return;
  }

  activeRequests += 1;
  lastActivityAt = Date.now();
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    activeRequests = Math.max(0, activeRequests - 1);
    lastActivityAt = Date.now();
  };

  // HTTP completion ends a request; upgraded sockets stay active until close.
  if (typeof res.writeHead === 'function') res.once('finish', complete);
  res.once('close', complete);
  if (typeof next === 'function') next();
}

function collectIfIdleAndUnderPressure() {
  if (activeRequests > 0) return;

  const before = process.memoryUsage();
  const urgent = before.rss >= URGENT_RSS_BYTES;
  if (!urgent && Date.now() - lastActivityAt < MIN_IDLE_MS) return;
  if (before.rss < RSS_PRESSURE_BYTES && before.heapUsed < HEAP_PRESSURE_BYTES) return;

  const now = Date.now();
  const cooldown = urgent ? URGENT_GC_COOLDOWN_MS : GC_COOLDOWN_MS;
  if (now - lastCollectionAt < cooldown) return;
  lastCollectionAt = now;

  try {
    global.gc();
    if (process.env.CC_TOOL_MEMORY_TRACE === '1') {
      const after = process.memoryUsage();
      console.log(`[MEM] idle-gc ${JSON.stringify({
        pid: process.pid,
        urgent,
        rssBefore: before.rss,
        rssAfter: after.rss,
        heapUsedBefore: before.heapUsed,
        heapUsedAfter: after.heapUsed
      })}`);
    }
  } catch (error) {
    console.warn(`[MEM] Idle memory collection failed: ${error.message}`);
  }
}

function startMemoryReclaimer() {
  if (timer || typeof global.gc !== 'function') return false;
  timer = setInterval(collectIfIdleAndUnderPressure, CHECK_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return true;
}

function stopMemoryReclaimer() {
  if (timer) clearInterval(timer);
  timer = null;
  activeRequests = 0;
  lastActivityAt = Date.now();
}

module.exports = {
  startMemoryReclaimer,
  stopMemoryReclaimer,
  trackMemoryActivity
};
