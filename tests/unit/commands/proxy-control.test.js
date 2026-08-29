'use strict';

const { createProxyControl, _test } = require('../../../src/commands/proxy-control');

describe('proxy-control registry integration', () => {
  function makeRegistry() {
    return {
      resolve: vi.fn((key) => key === 'demo-cli'
        ? {
            key,
            label: 'Demo CLI',
            apiBasePath: '/api/platforms/demo-cli',
            capabilities: { proxy: 'legacy:codex' }
          }
        : null),
      list: vi.fn(() => [{ key: 'demo-cli', label: 'Demo CLI' }])
    };
  }

  it('derives proxy endpoint from the resolved manifest', async () => {
    const httpRequest = vi.fn(async () => ({ data: { success: true, port: 23100 }, status: 200 }));
    const registry = makeRegistry();
    const control = createProxyControl({
      registry,
      httpRequest,
      loadConfig: () => ({ ports: { webUI: 19999 } })
    });

    await expect(control.start('demo-cli')).resolves.toMatchObject({
      response: { data: { success: true, port: 23100 } }
    });
    expect(httpRequest).toHaveBeenCalledWith('POST', '/api/platforms/demo-cli/proxy/start');
    expect(registry.resolve).toHaveBeenCalledWith('demo-cli');
  });

  it('keeps manifest metadata in service labels without a platform switch', () => {
    const registry = {
      resolve: () => ({
        key: 'managed-cli',
        label: 'Managed CLI',
        proxyMode: 'managed',
        proxyLabels: { serviceLabel: 'Managed Gateway', portLabel: 'Gateway port' }
      }),
      list: () => [{ key: 'managed-cli' }]
    };
    const info = _test.getPlatformInfo('managed-cli', registry);

    expect(info).toEqual(expect.objectContaining({
      key: 'managed-cli',
      name: 'Managed CLI',
      serviceLabel: 'Managed Gateway',
      portLabel: 'Gateway port',
      managedProviderConfig: true,
      aompPath: '/api/platforms/managed-cli/proxy'
    }));
  });

  it('rejects an unknown platform instead of falling back to Claude', async () => {
    const control = createProxyControl({
      registry: { resolve: () => null },
      httpRequest: vi.fn()
    });

    await expect(control.start('missing-cli')).rejects.toMatchObject({ code: 'INVALID_PLATFORM' });
  });
});
