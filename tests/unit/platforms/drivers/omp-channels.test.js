'use strict';

describe('OMP channels Driver', () => {
  test('returns structured provider operation failures', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/omp/channels');
    const cause = new Error('OMP provider unavailable');
    const driver = createDriver({ requireImpl: () => ({ getChannels: () => { throw cause; } }) });
    const result = driver.list();
    expect(result).toMatchObject({ status: 'failed', platform: 'omp', capability: 'channels', operation: 'list' });
    expect(result.cause).toBe(cause);
  });
});
