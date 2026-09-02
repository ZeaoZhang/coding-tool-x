'use strict';

describe('Codex channels Driver', () => {
  test('maps provider fields and preserves Codex sync operations', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/codex/channels');
    const calls = [];
    const driver = createDriver({
      requireImpl: () => ({
        getChannels: () => ({ channels: [] }),
        createChannel: (...args) => { calls.push(args); return { id: 'codex-1' }; },
        syncCurrentCodexChannel: () => ({ added: 1 }),
        updateChannel: () => ({ id: 'codex-1' }),
        deleteChannel: () => ({ success: true })
      })
    });

    expect(driver.create({
      name: 'Provider', providerKey: 'provider-a', baseUrl: 'https://codex.example',
      apiKey: 'secret', wireApi: 'responses', extra: { enabled: true }
    })).toMatchObject({ status: 'ok', data: { id: 'codex-1' } });
    expect(calls[0]).toEqual(['Provider', 'provider-a', 'https://codex.example', 'secret', 'responses', { enabled: true }]);
    expect(driver.syncCurrent()).toMatchObject({ status: 'ok', operation: 'syncCurrent', data: { added: 1 } });
  });

  test('returns structured invalid results for missing provider updates', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/codex/channels');
    const driver = createDriver({ requireImpl: () => ({}) });
    expect(driver.update('', {})).toEqual(expect.objectContaining({
      status: 'invalid', platform: 'codex', capability: 'channels', operation: 'update'
    }));
  });
});
