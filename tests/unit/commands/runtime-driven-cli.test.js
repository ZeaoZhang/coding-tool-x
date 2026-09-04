'use strict';

const inquirer = require('inquirer');
const menuModulePath = require.resolve('../../../src/ui/menu');

function createManifest(key, label = key) {
  return {
    key,
    label,
    terminalColor: 'blue',
    cliSelectable: true
  };
}

function createRuntimeHarness(platform, capabilities = ['channels', 'proxy']) {
  const calls = [];
  const drivers = {
    channels: {
      current: vi.fn(() => ({ name: `${platform} Channel` })),
      list: vi.fn(() => ({ channels: [{ name: `${platform} Channel` }] }))
    },
    proxy: {
      status: vi.fn(() => ({ running: false }))
    }
  };
  const registry = {
    resolve: vi.fn(key => key === platform ? createManifest(platform, platform === 'omp' ? 'OMP' : 'Demo CLI') : null),
    getCapability: vi.fn((_key, capability) => capabilities.includes(capability) ? 'fake' : null)
  };
  const runtime = {
    getDriver: vi.fn((key, capability) => {
      calls.push({ key, capability });
      if (key !== platform) throw new Error(`unexpected platform: ${key}`);
      return drivers[capability] || null;
    })
  };
  return { registry, runtime, calls, drivers };
}

async function runMenu(platform, harness) {
  vi.spyOn(inquirer, 'prompt').mockResolvedValue({ action: 'exit' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  delete require.cache[menuModulePath];
  const { showMainMenu } = require('../../../src/ui/menu');
  await showMainMenu({ currentCliType: platform }, {
    registry: harness.registry,
    runtime: harness.runtime
  });
}

describe('runtime-driven interactive menu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[menuModulePath];
  });

  test('routes custom platforms through their Runtime Drivers', async () => {
    const harness = createRuntimeHarness('demo-cli');

    await runMenu('demo-cli', harness);
    expect(harness.calls).toEqual([
      { key: 'demo-cli', capability: 'channels' },
      { key: 'demo-cli', capability: 'proxy' }
    ]);
    expect(harness.drivers.channels.current).toHaveBeenCalledTimes(1);
    expect(harness.drivers.proxy.status).toHaveBeenCalledTimes(1);
  });

  test('does not normalize omp to Claude', async () => {
    const harness = createRuntimeHarness('omp');

    await runMenu('omp', harness);

    expect(harness.calls.every(call => call.key === 'omp')).toBe(true);
    expect(harness.registry.resolve).toHaveBeenCalledWith('omp');
  });

  test('shows unsupported status without looking up Claude', async () => {
    const harness = createRuntimeHarness('demo-cli', []);

    await runMenu('demo-cli', harness);

    expect(harness.runtime.getDriver).not.toHaveBeenCalled();
    expect(console.log.mock.calls.flat().join('\n')).toContain('不可用');
  });
});
