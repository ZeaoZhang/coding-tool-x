'use strict';

const Module = require('module');
const RUNTIME_PATH = require.resolve('../../../src/platforms/runtime');

const { createPlatformRuntime } = require('../../../src/platforms/runtime');

test('creates injected capability drivers with invocation context', () => {
  const driver = { list: vi.fn(() => ['session-1']) };
  const driverRegistry = {
    create: vi.fn(() => driver)
  };
  const registry = {
    getCapability: vi.fn(() => 'generic-jsonl')
  };
  const dependencies = { clock: () => 123 };
  const runtime = createPlatformRuntime({ registry, driverRegistry, dependencies });

  expect(runtime.getDriver('demo-cli', 'sessions', { project: '/tmp/project' })).toBe(driver);
  expect(driverRegistry.create).toHaveBeenCalledWith('generic-jsonl', {
    platform: 'demo-cli',
    capability: 'sessions',
    context: { project: '/tmp/project' },
    dependencies
  });
  expect(runtime.invoke('demo-cli', 'sessions', 'list')).toEqual(['session-1']);
});

test('production singleton creates drivers through the default registry', () => {
  const driver = { list: vi.fn(() => ['built-in-session']) };
  const defaultDriverRegistry = {
    create: vi.fn(() => driver)
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === './driver-registry'
    ? { getDriverRegistry: () => defaultDriverRegistry }
    : originalLoad(request, parent, isMain);
  delete require.cache[RUNTIME_PATH];

  const { getPlatformRuntime } = require('../../../src/platforms/runtime');
  const runtime = getPlatformRuntime();

  expect(runtime.getDriver('claude', 'sessions')).toBe(driver);
  expect(defaultDriverRegistry.create).toHaveBeenCalledWith('legacy:claude', {
    platform: 'claude',
    capability: 'sessions',
    context: {},
    dependencies: {}
  });

  delete require.cache[RUNTIME_PATH];
  Module._load = originalLoad;
});

test('production singleton throws clearly when no default driver registry is available', () => {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === './driver-registry'
    ? (() => {
      const error = new Error("Cannot find module './driver-registry'");
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    })()
    : originalLoad(request, parent, isMain);
  delete require.cache[RUNTIME_PATH];
  try {
    const { getPlatformRuntime } = require('../../../src/platforms/runtime');
    expect(() => getPlatformRuntime()).toThrow(/Platform driver registry is not available/);
  } finally {
    delete require.cache[RUNTIME_PATH];
    Module._load = originalLoad;
  }
});
