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

  test('exposes offline catalog metadata through the driver operation', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/opencode/channels');
    const driver = createDriver({ requireImpl: () => ({ getChannels: () => ({ channels: [] }) }) });

    const result = driver.catalogMetadata({
      body: {
        providerKey: 'deepseek',
        allowedModels: ['deepseek/deepseek-v4-pro']
      }
    });

    expect(result).toMatchObject({
      status: 'ok',
      platform: 'opencode',
      capability: 'channels',
      operation: 'catalogMetadata'
    });
    expect(result.data.models).toEqual([
      expect.objectContaining({
        id: 'deepseek/deepseek-v4-pro',
        limit: expect.objectContaining({ context: expect.any(Number), output: expect.any(Number) })
      })
    ]);
    expect(result.data.source).toEqual(expect.objectContaining({ name: 'models.dev' }));
  });

  test('applies OpenCode channel defaults in its Driver adapter', () => {
    const { createDriver } = require('../../../../src/platforms/drivers/opencode/channels');
    const createChannel = vi.fn(input => input);
    const driver = createDriver({ requireImpl: () => ({ createChannel }) });

    driver.create({ name: 'OpenAI-compatible', baseUrl: 'https://example.test', apiKey: 'secret' });

    expect(createChannel).toHaveBeenCalledWith(
      'OpenAI-compatible',
      'https://example.test',
      'secret',
      expect.objectContaining({
        wireApi: 'openai',
        gatewaySourceType: 'codex',
        enabled: true,
        weight: 1,
        modelRedirects: [],
        allowedModels: []
      })
    );
  });
});
