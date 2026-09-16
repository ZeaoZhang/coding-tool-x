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
