'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PATHS_MODULE = require.resolve('../../../src/config/paths');
const WEBSOCKET_MODULE = require.resolve('../../../src/server/websocket-server');
const pathsModule = require(PATHS_MODULE);
const originalProxyLogsPath = pathsModule.PATHS.statistics.proxyLogs;

let testDir;
let websocket;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'websocket-log-persistence-'));
  pathsModule.PATHS.statistics.proxyLogs = path.join(testDir, 'proxy-logs.json');
  delete require.cache[WEBSOCKET_MODULE];
  websocket = require(WEBSOCKET_MODULE);
});

afterEach(async () => {
  await websocket?.flushPendingLogs?.();
  delete require.cache[WEBSOCKET_MODULE];
  pathsModule.PATHS.statistics.proxyLogs = originalProxyLogsPath;
  fs.rmSync(testDir, { recursive: true, force: true });
  vi.useRealTimers();
});

test('batches many broadcasts into one trailing persistence write', async () => {
  vi.useFakeTimers();
  const writeSpy = vi.spyOn(fs.promises, 'writeFile');

  for (let index = 0; index < 100; index += 1) {
    websocket.broadcastLog({
      id: `event-${index}`,
      timestamp: Date.now(),
      source: 'claude',
      tokens: { input: 1, total: 1 }
    });
  }

  expect(writeSpy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(249);
  expect(writeSpy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await websocket.flushPendingLogs();

  expect(writeSpy).toHaveBeenCalledTimes(1);
  const persisted = JSON.parse(fs.readFileSync(pathsModule.PATHS.statistics.proxyLogs, 'utf8'));
  expect(persisted).toHaveLength(100);
  writeSpy.mockRestore();
});

test('a clear waits behind an in-flight write and cannot be overwritten by its old snapshot', async () => {
  const originalWriteFile = fs.promises.writeFile;
  let releaseFirstWrite;
  let firstWriteStarted;
  const firstStarted = new Promise(resolve => { firstWriteStarted = resolve; });
  const firstWriteGate = new Promise(resolve => { releaseFirstWrite = resolve; });
  let writeCount = 0;
  const delayedWriteFile = async (...args) => {
    writeCount += 1;
    if (writeCount === 1) {
      firstWriteStarted();
      await firstWriteGate;
    }
    return Reflect.apply(originalWriteFile, fs.promises, args);
  };
  fs.promises.writeFile = delayedWriteFile;

  websocket.broadcastLog({ id: 'before-clear', source: 'claude', timestamp: Date.now() });
  const oldFlush = websocket.flushPendingLogs();
  await firstStarted;

  const clearFlush = websocket.clearAllLogs();
  releaseFirstWrite();
  await Promise.all([oldFlush, clearFlush]);
  await websocket.flushPendingLogs();

  expect(JSON.parse(fs.readFileSync(pathsModule.PATHS.statistics.proxyLogs, 'utf8'))).toEqual([]);
  fs.promises.writeFile = originalWriteFile;
});


test('coalesces blocked persistence into one latest pending snapshot', async () => {
  const original = fs.promises.writeFile;
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const firstStarted = new Promise(resolve => { started = resolve; });
  const writes = [];
  fs.promises.writeFile = async (...args) => {
    writes.push(args[1]);
    if (writes.length === 1) { started(); await gate; }
    return Reflect.apply(original, fs.promises, args);
  };
  try {
    websocket.broadcastLog({ id: 'first', source: 'claude' });
    const first = websocket.flushPendingLogs();
    await firstStarted;
    const flushes = [first];
    for (let i = 0; i < 25; i += 1) {
      websocket.broadcastLog({ id: `latest-${i}`, source: 'claude' });
      flushes.push(websocket.flushPendingLogs());
    }
    expect(websocket.getWebSocketDiagnostics().pendingWrites).toBe(1);
    release();
    await Promise.all(flushes);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1]).at(-1).id).toBe('latest-24');
  } finally {
    release();
    fs.promises.writeFile = original;
  }
});

test('all outbound messages terminate a client whose backlog exceeds the limit', () => {
  const ws = { readyState: 1, bufferedAmount: 1024 * 1024 + 1, terminate: vi.fn(), send: vi.fn() };
  expect(websocket._test.sendBounded(ws, 'hello')).toBe(false);
  expect(ws.terminate).toHaveBeenCalledTimes(1);
  expect(ws.send).not.toHaveBeenCalled();
});

test('history delivery stops immediately after a send exceeds the backlog budget', async () => {
  const ws = {
    readyState: 1, bufferedAmount: 0, terminate: vi.fn(),
    send: vi.fn(function () { this.bufferedAmount = 1024 * 1024 + 1; })
  };
  websocket._test.sendPersistedLogsInChunks(ws, Array.from({ length: 100 }, (_, id) => ({ id })));
  await new Promise(resolve => setImmediate(resolve));
  expect(ws.send).toHaveBeenCalledTimes(1);
  expect(ws.terminate).toHaveBeenCalledTimes(1);
});


test('one oversized outbound frame is rejected before buffering it', () => {
  const ws = { readyState: 1, bufferedAmount: 0, terminate: vi.fn(), send: vi.fn() };
  expect(websocket._test.sendBounded(ws, 'x'.repeat(1024 * 1024 + 1))).toBe(false);
  expect(ws.terminate).toHaveBeenCalledTimes(1);
  expect(ws.send).not.toHaveBeenCalled();
});

test('a failed write can be retried by a later flush without retaining old write payloads', async () => {
  const write = vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk busy'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    websocket.broadcastLog({ id: 'retry', source: 'claude' });
    await websocket.flushPendingLogs();
    expect(websocket.getWebSocketDiagnostics()).toMatchObject({ activeWrites: 0, pendingWrites: 0 });
    await websocket.flushPendingLogs();
    expect(write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fs.readFileSync(pathsModule.PATHS.statistics.proxyLogs, 'utf8'))[0].id).toBe('retry');
  } finally {
    write.mockRestore();
    error.mockRestore();
  }
});
