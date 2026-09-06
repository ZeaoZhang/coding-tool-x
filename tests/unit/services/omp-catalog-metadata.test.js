'use strict';

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock('child_process', async () => ({
  ...(await vi.importActual('child_process')),
  execFileSync
}));

const channels = require('../../../src/platforms/drivers/omp/channels-implementation');

describe('OMP offline catalog metadata', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('filters the bundled OMP catalog without invoking CLI or network', () => {
    const result = channels.getCatalogMetadata({ providerKey: 'deepseek' });

    expect(result.source).toMatchObject({
      name: 'models.dev',
      url: 'https://models.dev/api.json'
    });
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.models.every(model => model.toolTypes.includes('omp'))).toBe(true);
    expect(result.models.every(model => model.provider === 'deepseek')).toBe(true);
    expect(result.models.some(model => model.id === 'deepseek/deepseek-v4-pro')).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(execFileSync).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('returns only explicitly requested models instead of provider-wide metadata', () => {
    const result = channels.getCatalogMetadata({
      providerKey: 'deepseek',
      models: [{ id: 'gpt-5.5' }]
    })

    expect(result.models).toHaveLength(1)
    expect(result.models[0].id).toBe('gpt-5.5')
  });

  test('does not fall back to the complete catalog for unknown providers', () => {
    const result = channels.getCatalogMetadata({ providerKey: 'siliconflow' });

    expect(result.models).toEqual([]);
  });
});
