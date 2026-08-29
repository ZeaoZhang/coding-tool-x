import { beforeEach, describe, expect, test, vi } from 'vitest';

const client = {
  get: vi.fn(async () => ({ data: { success: true } })),
  post: vi.fn(async () => ({ data: { success: true } })),
  put: vi.fn(async () => ({ data: { success: true } })),
  delete: vi.fn(async () => ({ data: { success: true } }))
};

vi.mock('../../../src/web/src/api/client.js', () => ({ client }));

describe('OMP resource web API context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('skill and plugin listing pass the selected project cwd', async () => {
    const { getSkills } = await import('../../../src/web/src/api/skills.js');
    const { getPlugins } = await import('../../../src/web/src/api/plugins.js');

    await getSkills(false, 'omp', { cwd: '/workspace/project' });
    await getPlugins('omp', { cwd: '/workspace/project' });

    expect(client.get).toHaveBeenNthCalledWith(1, '/skills', {
      params: {
        refresh: '',
        platform: 'omp',
        cwd: '/workspace/project'
      },
      signal: expect.any(AbortSignal)
    });
    expect(client.get).toHaveBeenNthCalledWith(2, '/plugins', {
      params: {
        platform: 'omp',
        cwd: '/workspace/project'
      },
      signal: expect.any(AbortSignal)
    });
  });

  test('plugin mutations preserve full pluginId, project scope, cwd, and metadata', async () => {
    const {
      installPlugin,
      togglePlugin,
      uninstallPlugin,
      updatePluginConfig
    } = await import('../../../src/web/src/api/plugins.js');
    const context = { cwd: '/workspace/project', scope: 'project' };
    const metadata = {
      pluginId: 'review@team',
      name: 'review',
      marketplace: 'team',
      pluginKind: 'marketplace'
    };

    await installPlugin('', null, 'omp', 'review@team', context, metadata);
    await togglePlugin('review@team', false, 'omp', context);
    await updatePluginConfig('review@team', { model: 'fast' }, 'omp', context);
    await uninstallPlugin('review@team', 'omp', context);

    expect(client.post).toHaveBeenCalledWith('/plugins/install', expect.objectContaining({
      platform: 'omp',
      pluginId: 'review@team',
      source: 'review@team',
      marketplace: 'team',
      scope: 'project',
      cwd: '/workspace/project'
    }));
    expect(client.put).toHaveBeenCalledWith(
      '/plugins/review%40team/toggle',
      expect.objectContaining({ pluginId: 'review@team', scope: 'project', cwd: '/workspace/project' })
    );
    expect(client.put).toHaveBeenCalledWith(
      '/plugins/review%40team/config',
      expect.objectContaining({ pluginId: 'review@team', scope: 'project', cwd: '/workspace/project' })
    );
    expect(client.delete).toHaveBeenCalledWith('/plugins/review%40team', {
      params: expect.objectContaining({
        pluginId: 'review@team',
        scope: 'project',
        cwd: '/workspace/project'
      })
    });
  });
});
