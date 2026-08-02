import { beforeEach, describe, expect, test, vi } from 'vitest';

const { client } = vi.hoisted(() => ({
  client: {
    get: vi.fn(),
    put: vi.fn()
  }
}));

vi.mock('../../../src/web/src/api/client.js', () => ({ client }));

describe('OMP skill settings web integration', () => {
  beforeEach(() => {
    client.get.mockReset().mockResolvedValue({ data: { success: true, settings: {} } });
    client.put.mockReset().mockResolvedValue({ data: { success: true, settings: {} } });
  });

  test('calls the dedicated GET endpoint', async () => {
    const { getOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');

    await getOmpSkillSettings();

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('/skills/omp-settings');
  });

  test('calls the dedicated PUT endpoint with settings', async () => {
    const { updateOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');
    const settings = { enablePiProject: false };

    await updateOmpSkillSettings(settings);

    expect(client.put).toHaveBeenCalledTimes(1);
    expect(client.put).toHaveBeenCalledWith('/skills/omp-settings', settings);
  });

  test.each([
    ['omp', true],
    ['claude', false],
    ['codex', false],
    ['gemini', false],
    ['opencode', false]
  ])('supports OMP skill settings for %s: %s', async (platform, expected) => {
    const { supportsOmpSkillSettings } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );

    expect(supportsOmpSkillSettings(platform)).toBe(expected);
  });

  test('closes settings before awaiting one forced skill refresh', async () => {
    const { completeOmpSkillSettingsSave } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );
    const events = [];
    let finishRefresh;
    const closeSettings = vi.fn(() => events.push('closed'));
    const refreshSkills = vi.fn(() => {
      events.push('refreshing');
      return new Promise(resolve => {
        finishRefresh = resolve;
      });
    });

    let completed = false;
    const completion = completeOmpSkillSettingsSave(closeSettings, refreshSkills).then(() => {
      completed = true;
    });

    expect(events).toEqual(['closed', 'refreshing']);
    expect(closeSettings).toHaveBeenCalledTimes(1);
    expect(refreshSkills).toHaveBeenCalledTimes(1);
    expect(refreshSkills).toHaveBeenCalledWith(true);
    expect(completed).toBe(false);

    finishRefresh();
    await completion;
    expect(completed).toBe(true);
  });

  test('propagates a settings write failure', async () => {
    const error = new Error('write failed');
    client.put.mockRejectedValueOnce(error);
    const { updateOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');

    await expect(updateOmpSkillSettings({ enablePiUser: false })).rejects.toBe(error);
  });

  test('propagates a settings read failure', async () => {
    client.get.mockRejectedValueOnce(new Error('read failed'));
    const { getOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');

    await expect(getOmpSkillSettings()).rejects.toThrow('read failed');
  });
});
