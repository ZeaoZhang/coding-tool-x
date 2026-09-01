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

  test('local Skill listing omits refresh flags and preserves project scope', async () => {
    const { getSkills } = await import('../../../src/web/src/api/skills.js');
    const { getPlugins } = await import('../../../src/web/src/api/plugins.js');

    await getSkills('omp', { cwd: '/workspace/project', scope: 'project' });
    await getPlugins('omp', { cwd: '/workspace/project' });

    expect(client.get).toHaveBeenNthCalledWith(1, '/skills', {
      params: {
        platform: 'omp',
        scope: 'project',
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

  test('manual Skill refresh and toggle use explicit control endpoints', async () => {
    const { refreshSkills, toggleSkill } = await import('../../../src/web/src/api/skills.js');

    await refreshSkills('omp', { scope: 'user' });
    await toggleSkill('skill:omp:user:user:demo', false, 'omp', { scope: 'user' });

    expect(client.post).toHaveBeenCalledWith('/skills/refresh', {
      platform: 'omp',
      scope: 'user'
    });
    expect(client.put).toHaveBeenCalledWith('/skills/toggle', {
      controlKey: 'skill:omp:user:user:demo',
      enabled: false,
      platform: 'omp',
      scope: 'user'
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
