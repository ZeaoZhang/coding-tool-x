'use strict';

describe('OpenCode channels Driver', () => {
  test('keeps provider-specific fields in extra', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/opencode/channels');
    const service = {
      getChannels: () => ({ channels: [{ id: 'o', providerId: 'claude', preferCodexApiKey: true }] })
    };
    const driver = createDriver({ requireImpl: () => service });
    expect(driver.list().data.channels[0]).toEqual({
      id: 'o',
      extra: { providerId: 'claude', preferCodexApiKey: true }
    });
  });
});
