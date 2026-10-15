'use strict';

const { createDriver } = require('../../../../src/platforms/drivers/omp/channels');

describe('OMP channels Driver', () => {
  test('returns structured provider operation failures', () => {
    const cause = new Error('OMP provider unavailable');
    const driver = createDriver({ requireImpl: () => ({ getChannels: () => { throw cause; } }) });
    const result = driver.list();
    expect(result).toMatchObject({ status: 'failed', platform: 'omp', capability: 'channels', operation: 'list' });
    expect(result.cause).toBe(cause);
  });

  test('exposes offline catalog metadata through the driver operation', () => {
    const catalog = {
      models: [{ id: 'deepseek/deepseek-v4-pro' }],
      warnings: [],
      source: { name: 'models.dev' }
    };
    const getCatalogMetadata = vi.fn().mockReturnValue(catalog);
    const driver = createDriver({
      requireImpl: () => ({
        getChannels: () => [],
        getCatalogMetadata
      })
    });

    expect(driver.catalogMetadata({ body: { providerKey: 'deepseek' } })).toMatchObject({
      status: 'ok',
      platform: 'omp',
      capability: 'channels',
      operation: 'catalogMetadata',
      data: catalog
    });
    expect(getCatalogMetadata).toHaveBeenCalledWith({ providerKey: 'deepseek' });
  });

  test('adapts generic create payloads and derives the provider API in the platform Driver', () => {
    const createChannel = vi.fn(input => input);
    const driver = createDriver({ requireImpl: () => ({ createChannel }) });

    const result = driver.create({
      name: 'Claude upstream',
      baseUrl: 'https://example.test',
      apiKey: 'secret',
      gatewaySourceType: 'claude'
    });

    expect(result.status).toBe('ok');
    expect(createChannel).toHaveBeenCalledWith(
      'Claude upstream',
      'https://example.test',
      'secret',
      expect.objectContaining({
        gatewaySourceType: 'claude',
        providerApi: 'anthropic-messages',
        wireApi: 'openai',
        enabled: true,
        models: []
      })
    );
  });

  test('accepts the generic API reset payload in its Driver', () => {
    const health = require('../../../../src/server/services/channel-health');
    const resetChannelHealth = vi.spyOn(health, 'resetChannelHealth').mockImplementation(() => {});
    const driver = createDriver({ requireImpl: () => ({}) });

    expect(driver.resetHealth({ channelId: 'omp-channel' })).toEqual({ channelId: 'omp-channel', reset: true });
    expect(resetChannelHealth).toHaveBeenCalledWith('omp-channel', 'omp');
    resetChannelHealth.mockRestore();
  });

});
