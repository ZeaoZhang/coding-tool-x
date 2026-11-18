'use strict';

const {
  resolveChannelCatalogMetadata
} = require('../../../src/shared/channel-model-metadata');

describe('resolveChannelCatalogMetadata', () => {
  test('resolves requested model IDs against the packaged snapshot', () => {
    const result = resolveChannelCatalogMetadata({
      toolType: 'opencode',
      model: 'deepseek/deepseek-v4-pro',
      models: [{ id: 'gpt-5.4' }, 'custom-model'],
      availableModels: [{ label: 'DeepSeek V4 Pro', value: 'deepseek/deepseek-v4-pro' }]
    });

    expect(result.source).toEqual(expect.objectContaining({ name: 'models.dev' }));
    expect(result.warnings).toEqual([]);
    expect(result.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'deepseek/deepseek-v4-pro',
        limit: expect.objectContaining({ context: expect.any(Number), output: expect.any(Number) })
      }),
      expect.objectContaining({ id: 'gpt-5.4' })
    ]));
    expect(result.models).toHaveLength(2);
  });

  test('preserves the requested ID when a catalog ID is an alias or suffix', () => {
    const alias = resolveChannelCatalogMetadata({
      toolType: 'opencode',
      model: 'claude-haiku-4-5'
    });
    expect(alias.models).toEqual([
      expect.objectContaining({ id: 'claude-haiku-4-5' })
    ]);

    const suffix = resolveChannelCatalogMetadata({
      toolType: 'opencode',
      model: 'deepseek-v4-pro'
    });
    expect(suffix.models).toEqual([
      expect.objectContaining({ id: 'deepseek-v4-pro' })
    ]);
  });

  test('matches runtime IDs against catalog display names with release suffixes', () => {
    const result = resolveChannelCatalogMetadata({
      model: 'deepseek-v4.1-flash',
      allowedModels: ['deepseek-v4.1-flash']
    });

    expect(result.models).toEqual([
      expect.objectContaining({
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash 1017',
        limit: { context: 1048576, output: 393216 },
        reasoning: true
      })
    ]);
  });

  test('falls back to the provider catalog when no model IDs are requested', () => {
    const result = resolveChannelCatalogMetadata({
      toolType: 'opencode',
      providerKey: 'deepseek'
    });

    expect(result.models.length).toBeGreaterThan(1);
    expect(result.models.every(model => String(model.id).startsWith('deepseek/'))).toBe(true);
  });

  test('keeps the tool filter and returns no models for unknown requested IDs', () => {
    const foreign = resolveChannelCatalogMetadata({
      toolType: 'claude',
      model: 'deepseek/deepseek-v4-pro'
    });
    expect(foreign.models).toEqual([]);

    const unknown = resolveChannelCatalogMetadata({
      toolType: 'opencode',
      model: 'not-in-the-offline-snapshot'
    });
    expect(unknown.models).toEqual([]);
  });

  test('does not mutate the packaged catalog entries', () => {
    const first = resolveChannelCatalogMetadata({
      toolType: 'opencode',
      model: 'deepseek/deepseek-v4-pro'
    });
    first.models[0].limit.context = 1;

    const second = resolveChannelCatalogMetadata({
      toolType: 'opencode',
      model: 'deepseek/deepseek-v4-pro'
    });
    expect(second.models[0].limit.context).not.toBe(1);
  });
});
