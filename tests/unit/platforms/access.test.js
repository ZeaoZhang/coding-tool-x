'use strict';

const {
  resolvePlatform,
  resolveCapability,
  resolveOperation
} = require('../../../src/platforms/access');

function createRegistry(manifest, driverId = 'generic-jsonl') {
  return {
    resolve: vi.fn(key => key === manifest.key ? manifest : null),
    getCapability: vi.fn((key, capability) => (
      key === manifest.key && manifest.capabilities?.[capability]
        ? driverId
        : null
    ))
  };
}

function thrownError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}

test('resolves a normalized platform through the Registry', () => {
  const manifest = { key: 'demo-cli', label: 'Demo CLI' };
  const registry = createRegistry(manifest);

  expect(resolvePlatform(' DEMO-CLI ', { registry })).toEqual({
    key: 'demo-cli',
    manifest
  });
  expect(registry.resolve).toHaveBeenCalledWith('demo-cli');
});

test('reports an unknown non-empty platform as not_found', () => {
  const registry = createRegistry({ key: 'demo-cli' });

  const error = thrownError(() => resolvePlatform('missing', {
    registry,
    fallback: 'demo-cli'
  }));

  expect(error).toMatchObject({
    code: 'not_found',
    platform: 'missing'
  });
  expect(registry.resolve).toHaveBeenCalledWith('missing');
  expect(registry.resolve).not.toHaveBeenCalledWith('demo-cli');
});

test('resolves a declared capability through the Runtime', () => {
  const manifest = {
    key: 'demo-cli',
    capabilities: { sessions: 'generic-jsonl' }
  };
  const registry = createRegistry(manifest);
  const driver = { recent: vi.fn() };
  const runtime = { getDriver: vi.fn(() => driver) };

  expect(resolveCapability('demo-cli', 'sessions', { registry, runtime })).toEqual({
    key: 'demo-cli',
    manifest,
    driver
  });
  expect(runtime.getDriver).toHaveBeenCalledWith('demo-cli', 'sessions');
});

test('reports a missing capability as unsupported without creating a Driver', () => {
  const manifest = { key: 'demo-cli', capabilities: {} };
  const registry = createRegistry(manifest);
  const runtime = { getDriver: vi.fn() };

  const error = thrownError(() => resolveCapability('demo-cli', 'sessions', {
    registry,
    runtime
  }));

  expect(error).toMatchObject({
    code: 'unsupported',
    platform: 'demo-cli',
    capability: 'sessions'
  });
  expect(runtime.getDriver).not.toHaveBeenCalled();
});

test('returns a bound operation from a capability Driver', () => {
  const manifest = {
    key: 'demo-cli',
    capabilities: { sessions: 'generic-jsonl' }
  };
  const registry = createRegistry(manifest);
  const driver = {
    recent: vi.fn(function recent() {
      return this;
    })
  };
  const runtime = { getDriver: vi.fn(() => driver) };

  const result = resolveOperation('demo-cli', 'sessions', 'recent', {
    registry,
    runtime
  });

  expect(result).toMatchObject({ key: 'demo-cli', manifest, driver });
  expect(result.operation()).toBe(driver);
});

test('reports a missing Driver operation as unsupported', () => {
  const manifest = {
    key: 'demo-cli',
    capabilities: { sessions: 'generic-jsonl' }
  };
  const registry = createRegistry(manifest);
  const runtime = { getDriver: vi.fn(() => ({ listSessions: vi.fn() })) };

  const error = thrownError(() => resolveOperation('demo-cli', 'sessions', 'recent', {
    registry,
    runtime
  }));

  expect(error).toMatchObject({
    code: 'unsupported',
    platform: 'demo-cli',
    capability: 'sessions',
    operation: 'recent'
  });
});

test('uses the explicit fallback only for an empty platform key', () => {
  const manifest = { key: 'demo-cli', label: 'Demo CLI' };
  const registry = createRegistry(manifest);

  expect(resolvePlatform('', { registry, fallback: 'demo-cli' })).toEqual({
    key: 'demo-cli',
    manifest
  });
  expect(registry.resolve).toHaveBeenCalledWith('demo-cli');
});

test('reports Runtime creation failures as failed with a hidden cause', () => {
  const manifest = {
    key: 'demo-cli',
    capabilities: { sessions: 'generic-jsonl' }
  };
  const registry = createRegistry(manifest);
  const cause = new Error('driver constructor failed');
  const runtime = { getDriver: vi.fn(() => { throw cause; }) };

  const error = thrownError(() => resolveCapability('demo-cli', 'sessions', {
    registry,
    runtime
  }));

  expect(error).toMatchObject({
    code: 'failed',
    platform: 'demo-cli',
    capability: 'sessions'
  });
  expect(error.cause).toBe(cause);
  expect(Object.keys(error)).not.toContain('cause');
});
