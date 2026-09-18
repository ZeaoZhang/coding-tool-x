'use strict';

const { _test } = require('../../src/server/index');

test('autoRestoreProxies restores platforms sequentially and continues after failure', async () => {
  const order = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const makeDriver = (key, shouldFail = false) => ({
    restoreOnBoot: vi.fn(async () => {
      order.push(`${key}:start`);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 2));
      inFlight -= 1;
      order.push(`${key}:end`);
      if (shouldFail) throw new Error(`${key} unavailable`);
      return { status: 'ok' };
    })
  });

  const drivers = {
    claude: makeDriver('claude', true),
    codex: makeDriver('codex'),
    gemini: makeDriver('gemini')
  };
  const result = await _test.autoRestoreProxies({
    config: { marker: 'shared-config' },
    registry: {
      list: () => Object.keys(drivers).map(key => ({ key, label: key }))
    },
    runtime: {
      getDriver: key => drivers[key]
    },
    fsImpl: { existsSync: () => true }
  });

  expect(maxInFlight).toBe(1);
  expect(order).toEqual([
    'claude:start', 'claude:end',
    'codex:start', 'codex:end',
    'gemini:start', 'gemini:end'
  ]);
  expect(result).toEqual({ attempted: 3, restored: 2, failed: 1 });
  expect(drivers.codex.restoreOnBoot).toHaveBeenCalledWith({ config: { marker: 'shared-config' } });
});

test('refreshes native Codex OAuth during startup without exposing refresh failures', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const refreshNativeCodexOAuth = vi.fn(async () => ({
    available: true,
    refreshed: true,
    synchronized: true
  }));

  await expect(_test.refreshNativeCodexOAuthOnStartup({
    oauthService: { refreshNativeCodexOAuth }
  })).resolves.toMatchObject({
    available: true,
    refreshed: true,
    synchronized: true
  });
  expect(refreshNativeCodexOAuth).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith('[Codex OAuth] Native OAuth token refreshed during startup');

  refreshNativeCodexOAuth.mockRejectedValueOnce(new Error('refresh unavailable'));
  await expect(_test.refreshNativeCodexOAuthOnStartup({
    oauthService: { refreshNativeCodexOAuth }
  })).resolves.toMatchObject({
    available: false,
    refreshed: false,
    synchronized: false,
    error: 'refresh unavailable'
  });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('refresh unavailable'));

  log.mockRestore();
  warn.mockRestore();
});

test('startup memory tracing is opt-in and exposes the five V8/process memory counters', () => {
  process.env.CC_TOOL_MEMORY_TRACE = '1';
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  _test.traceStartupMemory('unit-test');
  const [line] = log.mock.calls[0];
  const payload = JSON.parse(String(line).slice('[MEM] unit-test '.length));
  expect(payload).toEqual(expect.objectContaining({
    rss: expect.any(Number),
    heapUsed: expect.any(Number),
    heapTotal: expect.any(Number),
    external: expect.any(Number),
    arrayBuffers: expect.any(Number)
  }));
  log.mockRestore();
  delete process.env.CC_TOOL_MEMORY_TRACE;
});
