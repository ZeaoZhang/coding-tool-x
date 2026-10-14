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

  test('returns a credential-free model routing summary beside the scheduler snapshot', () => {
    const channels = [
      {
        id: 'fast',
        name: 'Fast',
        providerKey: 'openai-main',
        providerApi: 'openai-responses',
        routingGroup: 'main',
        baseUrl: 'https://fast.example/v1',
        apiKey: 'upstream-secret',
        enabled: true,
        models: [{ id: 'gpt-5' }]
      },
      {
        id: 'backup',
        name: 'Backup',
        providerKey: 'openai-main',
        providerApi: 'openai-responses',
        routingGroup: 'main',
        baseUrl: 'https://backup.example/v1',
        apiKey: 'another-secret',
        enabled: true,
        allowedModels: ['gpt-5']
      }
    ];
    const driver = createDriver({
      schedulerStateProvider: () => ({ channels: [{ id: 'fast', inflight: 2, maxConcurrency: 4 }], pending: 0 }),
      requireImpl: () => ({
        getChannels: () => channels,
        loadManagedOmpModeState: () => null
      })
    });

    const result = driver.poolStatus();
    expect(result).toMatchObject({
      status: 'ok',
      operation: 'poolStatus',
      data: {
        scheduler: { channels: [{ id: 'fast', inflight: 2, maxConcurrency: 4 }] },
        routingSummary: {
          groups: [{
            routingGroup: 'main',
            models: [{ id: 'gpt-5', channelIds: ['fast', 'backup'] }]
          }]
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain('upstream-secret');
    expect(JSON.stringify(result)).not.toContain('another-secret');
  });

});
