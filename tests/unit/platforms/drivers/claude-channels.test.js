'use strict';

describe('Claude channels Driver', () => {
  test('maps stable CRUD operations to the Claude implementation', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/claude/channels');
    const calls = [];
    const driver = createDriver({
      requireImpl: () => ({
        getAllChannels: () => [],
        createChannel: (...args) => { calls.push(args); return { id: 'claude-1' }; },
        updateChannel: (id, patch) => ({ id, ...patch }),
        deleteChannel: id => ({ success: true, id }),
        syncCurrentClaudeChannel: () => ({ added: 0 }),
        getEffectiveApiKey: channel => channel.apiKey
      })
    });

    expect(driver.create({ name: 'Primary', baseUrl: 'https://claude.example', apiKey: 'secret' })).toMatchObject({
      status: 'ok', platform: 'claude', capability: 'channels', operation: 'create', data: { id: 'claude-1' }
    });
    expect(calls[0]).toEqual(['Primary', 'https://claude.example', 'secret', undefined, {}]);
    expect(driver.syncCurrent()).toMatchObject({ status: 'ok', operation: 'syncCurrent', data: { added: 0 } });
  });

  test('keeps OpenAI-compatible target validation in the Driver implementation', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/claude/channels');
    const driver = createDriver({
      requireImpl: () => ({
        getAllChannels: () => [],
        applyChannelToSettings: () => { throw new Error('OpenAI 格式渠道需要通过 Claude 代理使用'); }
      })
    });
    expect(driver.applyNativeConfig('channel-1')).toMatchObject({ status: 'failed', operation: 'applyNativeConfig' });
  });
});
