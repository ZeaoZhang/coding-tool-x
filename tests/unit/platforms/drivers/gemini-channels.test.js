'use strict';

describe('Gemini channels Driver', () => {
  test('reports provider config operations through the stable contract', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/gemini/channels');
    const service = {
      getChannels: () => ({ channels: [{ id: 'g', apiKey: 'secret', apiFormat: 'vertex_ai_v1' }] }),
      createChannel: () => ({ id: 'g' }),
      updateChannel: () => ({ id: 'g' }),
      deleteChannel: () => ({ success: true }),
      syncCurrentGeminiChannel: () => ({ added: 0 })
    };
    const driver = createDriver({ requireImpl: () => service });
    expect(driver.list()).toMatchObject({ status: 'ok', data: { channels: [{ id: 'g', extra: { apiFormat: 'vertex_ai_v1' } }] } });
    expect(driver.syncCurrent()).toMatchObject({ status: 'ok', operation: 'syncCurrent' });
  });
});
