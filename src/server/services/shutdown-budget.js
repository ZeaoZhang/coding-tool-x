'use strict';

/**
 * 关闭时间预算。
 *
 * 关停一条链路要经过三个阶段，每个阶段都必须在下一个阶段接管前结束，
 * 否则「优雅退出」会退化成「被 SIGKILL」，表现就是 `ctx stop` 长时间无响应：
 *
 *   drain(排空在途代理/OMP 流) < hardStop(整个清理的硬上限) <= killTimeout(PM2 转 SIGKILL)
 *
 * - drain：`expediteServerShutdown` 到点会强制关闭连接并销毁 socket，所以是有界的；
 * - hardStop：排空之后的日志落盘、统计、SQLite 关闭都是无超时 await，必须靠它兜底；
 * - killTimeout：PM2 的 `kill_timeout`，必须大于 hardStop，否则会在清理途中被杀。
 */

const DEFAULT_DRAIN_MS = 10_000;
const DEFAULT_HARD_STOP_MS = 15_000;
const DEFAULT_KILL_TIMEOUT_MS = 20_000;

// PM2 的 kill_timeout 要比 hardStop 晚到，留出余量给 SIGKILL 之前的最后一次机会。
const KILL_TIMEOUT_MARGIN_MS = 5_000;

function readPositiveInt(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * 从环境变量解析关闭预算，并通过取大值保证阶段次序。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ drainMs: number, hardStopMs: number, killTimeoutMs: number }}
 */
function resolveShutdownBudget(env = process.env) {
  const drainMs = readPositiveInt(env.CC_TOOL_STOP_DRAIN_MS, DEFAULT_DRAIN_MS);

  const requestedHardStopMs = readPositiveInt(env.CC_TOOL_STOP_HARD_TIMEOUT_MS, DEFAULT_HARD_STOP_MS);
  const hardStopMs = Math.max(requestedHardStopMs, drainMs);

  const minimumKillTimeoutMs = Math.max(DEFAULT_KILL_TIMEOUT_MS, hardStopMs + KILL_TIMEOUT_MARGIN_MS);
  const killTimeoutMs = Math.max(
    readPositiveInt(env.CC_TOOL_STOP_KILL_TIMEOUT_MS, minimumKillTimeoutMs),
    hardStopMs + KILL_TIMEOUT_MARGIN_MS
  );

  return { drainMs, hardStopMs, killTimeoutMs };
}

/**
 * 启动硬退出看门狗。计时器 unref，避免它自己把进程吊住；
 * 真的挂住时（有连接等 handle 撑着事件循环）才会触发。
 *
 * @param {number} hardStopMs
 * @param {() => void} onTimeout
 * @returns {{ timer: any, cancel: () => void }}
 */
function startShutdownWatchdog(hardStopMs, onTimeout) {
  const timer = setTimeout(onTimeout, hardStopMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return {
    timer,
    cancel: () => clearTimeout(timer)
  };
}

module.exports = {
  DEFAULT_DRAIN_MS,
  DEFAULT_HARD_STOP_MS,
  DEFAULT_KILL_TIMEOUT_MS,
  KILL_TIMEOUT_MARGIN_MS,
  resolveShutdownBudget,
  startShutdownWatchdog
};
