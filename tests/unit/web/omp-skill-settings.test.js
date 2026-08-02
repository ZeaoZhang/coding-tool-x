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

  test('refreshes the skill list once after a successful settings save', async () => {
    const { refreshAfterOmpSkillSettingsSave } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );
    const refreshSkills = vi.fn().mockResolvedValue(undefined);

    await refreshAfterOmpSkillSettingsSave(refreshSkills);

    expect(refreshSkills).toHaveBeenCalledTimes(1);
    expect(refreshSkills).toHaveBeenCalledWith(true);
  });

  test('propagates a settings write failure without touching an existing list', async () => {
    const existingSkills = [{ key: 'kept' }];
    client.put.mockRejectedValueOnce(new Error('write failed'));
    const { updateOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');

    await expect(updateOmpSkillSettings({ enablePiUser: false })).rejects.toThrow('write failed');
    expect(existingSkills).toEqual([{ key: 'kept' }]);
  });

  test('propagates a settings read failure without touching an existing list', async () => {
    const existingSkills = [{ key: 'kept' }];
    client.get.mockRejectedValueOnce(new Error('read failed'));
    const { getOmpSkillSettings } = await import('../../../src/web/src/api/skills.js');

    await expect(getOmpSkillSettings()).rejects.toThrow('read failed');
    expect(existingSkills).toEqual([{ key: 'kept' }]);
  });
});
