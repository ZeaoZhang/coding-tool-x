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
    const driver = createDriver({
      requireImpl: () => ({
        getChannels: () => [],
        getCatalogMetadata: vi.fn().mockReturnValue(catalog)
      })
    });

    expect(driver.catalogMetadata({ body: { providerKey: 'deepseek' } })).toMatchObject({
      status: 'ok',
      platform: 'omp',
      capability: 'channels',
      operation: 'catalogMetadata',
      data: catalog
    });
  });
});
