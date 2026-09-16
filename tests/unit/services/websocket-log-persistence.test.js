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
