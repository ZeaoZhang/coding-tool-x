'use strict';

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
