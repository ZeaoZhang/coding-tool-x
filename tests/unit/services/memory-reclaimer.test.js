const { EventEmitter } = require('events');

describe('memory reclaimer under proxy traffic', () => {
  let reclaimer;
  let originalGc;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T00:00:00Z'));
    originalGc = global.gc;
    global.gc = vi.fn();
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 460 * 1024 * 1024,
      heapUsed: 200 * 1024 * 1024
    });
    delete require.cache[require.resolve('../../../src/server/services/memory-reclaimer')];
    reclaimer = require('../../../src/server/services/memory-reclaimer');
    reclaimer.startMemoryReclaimer();
  });

  afterEach(() => {
    reclaimer.stopMemoryReclaimer();
    if (originalGc === undefined) delete global.gc;
    else global.gc = originalGc;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('collects near the restart threshold despite recent completed UI polling', () => {
    const response = Object.assign(new EventEmitter(), { writeHead() {} });
    reclaimer.trackMemoryActivity({}, response, () => {});
    response.emit('finish');
    vi.advanceTimersByTime(5000);
    expect(global.gc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(25000);
    expect(global.gc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(global.gc).toHaveBeenCalledTimes(2);
  });

  it('waits for an active streaming response to close before collecting', () => {
    const response = Object.assign(new EventEmitter(), { writeHead() {} });
    reclaimer.trackMemoryActivity({}, response);
    vi.advanceTimersByTime(60000);
    expect(global.gc).not.toHaveBeenCalled();
    response.emit('close');
    vi.advanceTimersByTime(5000);
    expect(global.gc).toHaveBeenCalledTimes(1);
  });

  it('keeps an upgraded socket active until close, including after a writable finish', () => {
    const socket = new EventEmitter();
    reclaimer.trackMemoryActivity({}, socket);
    socket.emit('finish');
    vi.advanceTimersByTime(60000);
    expect(global.gc).not.toHaveBeenCalled();
    socket.emit('close');
    vi.advanceTimersByTime(5000);
    expect(global.gc).toHaveBeenCalledTimes(1);
  });

  it('tracks without exposed GC and releases both completion listeners once', () => {
    delete global.gc;
    const response = Object.assign(new EventEmitter(), { writeHead() {} });
    reclaimer.trackMemoryActivity({}, response);
    reclaimer.trackMemoryActivity({}, response);
    expect(reclaimer.getMemoryDiagnostics().activeRequests).toBe(1);
    response.emit('close');
    response.emit('finish');
    expect(reclaimer.getMemoryDiagnostics().activeRequests).toBe(0);
    expect(response.listenerCount('finish')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  it('prints body-free diagnostics every30seconds when enabled', () => {
    const previous = process.env.CC_TOOL_MEMORY_TRACE;
    process.env.CC_TOOL_MEMORY_TRACE = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      reclaimer.stopMemoryReclaimer();
      delete global.gc;
      reclaimer.startMemoryReclaimer();
      vi.advanceTimersByTime(30000);
      const sample = log.mock.calls.find(([line]) => line.startsWith('[MEM] sample '));
      expect(sample).toBeDefined();
      const diagnostic = JSON.parse(sample[0].slice('[MEM] sample '.length));
      expect(diagnostic.pid).toBe(process.pid);
      expect(diagnostic.activeRequests).toBe(0);
      expect(diagnostic.pressure.paused).toBe(true);
      expect(sample[0]).not.toContain('headers');
      expect(sample[0]).not.toContain('body');
    } finally {
      if (previous === undefined) delete process.env.CC_TOOL_MEMORY_TRACE;
      else process.env.CC_TOOL_MEMORY_TRACE = previous;
    }
  });
});
