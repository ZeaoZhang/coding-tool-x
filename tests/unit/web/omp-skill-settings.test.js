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

    let completedResult;
    const completion = completeOmpSkillSettingsSave(closeSettings, refreshSkills).then(result => {
      completed = true;
      completedResult = result;
    });

    expect(events).toEqual(['closed', 'refreshing']);
    expect(closeSettings).toHaveBeenCalledTimes(1);
    expect(refreshSkills).toHaveBeenCalledTimes(1);
    expect(refreshSkills).toHaveBeenCalledWith(true, { notifyError: false });
    expect(completed).toBe(false);

    finishRefresh(true);
    await completion;
    expect(completed).toBe(true);
    expect(completedResult).toBe(true);
  });

  test('propagates settings update rejection without invoking a callback', async () => {
    const { submitOmpSkillSettings } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );
    const error = new Error('write failed');
    const settings = {
      enableCodexUser: true,
      enableClaudeUser: false,
      enablePiUser: true,
      enablePiProject: false
    };
    const updateSettings = vi.fn().mockRejectedValue(error);

    await expect(submitOmpSkillSettings(settings, updateSettings)).rejects.toBe(error);

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(settings);
  });

  test('rejects validator mismatch directly without invoking a success callback', async () => {
    const { submitOmpSkillSettings } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );
    const settings = {
      enableCodexUser: true,
      enableClaudeUser: true,
      enablePiUser: true,
      enablePiProject: false
    };
    const result = { success: true, settings: { ...settings, enablePiProject: true } };
    const updateSettings = vi.fn().mockResolvedValue(result);

    await expect(submitOmpSkillSettings(settings, updateSettings)).rejects.toThrow(
      '响应 settings 与提交值不一致'
    );

    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  test('returns validated settings after one successful update without a callback', async () => {
    const { submitOmpSkillSettings } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );
    const settings = {
      enableCodexUser: true,
      enableClaudeUser: false,
      enablePiUser: true,
      enablePiProject: false
    };
    const result = { success: true, settings: { ...settings } };
    const updateSettings = vi.fn().mockResolvedValue(result);

    const savedSettings = await submitOmpSkillSettings(settings, updateSettings);

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(settings);
    expect(savedSettings).toEqual(settings);
    expect(savedSettings).not.toBe(result.settings);
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
