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

  test('does not emit saved or trigger parent completion when the settings update rejects', async () => {
    const { submitOmpSkillSettings } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );
    const error = new Error('write failed');
    const settings = { enablePiUser: false };
    const updateSettings = vi.fn().mockRejectedValue(error);
    const saved = vi.fn();
    const closeSettings = vi.fn();
    const refreshSkills = vi.fn();
    const onSuccess = vi.fn(result => {
      saved(result.settings);
      closeSettings();
      refreshSkills(true);
    });

    await expect(submitOmpSkillSettings(settings, updateSettings, onSuccess)).rejects.toBe(error);

    expect(saved).not.toHaveBeenCalled();
    expect(closeSettings).not.toHaveBeenCalled();
    expect(refreshSkills).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test('does not notify or refresh when the modal save validator throws', async () => {
    const { submitOmpSkillSettings, validateOmpSkillSettingsSaveResult } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );
    const settings = {
      enableCodexUser: true,
      enableClaudeUser: true,
      enablePiUser: true,
      enablePiProject: false
    };
    const result = { success: true, settings: { ...settings, enablePiProject: true } };
    const notifySaved = vi.fn();
    const refreshSkills = vi.fn();
    const onSuccess = vi.fn(response => {
      validateOmpSkillSettingsSaveResult(response, settings);
      notifySaved();
      refreshSkills(true);
    });

    await expect(
      submitOmpSkillSettings(settings, vi.fn().mockResolvedValue(result), onSuccess)
    ).rejects.toThrow('响应 settings 与提交值不一致');

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(notifySaved).not.toHaveBeenCalled();
    expect(refreshSkills).not.toHaveBeenCalled();
  });

  test('calls the success callback synchronously once and returns without awaiting it', async () => {
    const { submitOmpSkillSettings } = await import(
      '../../../src/web/src/utils/omp-skill-settings.js'
    );
    const settings = { enablePiProject: false };
    const result = { success: true, settings };
    const updateSettings = vi.fn().mockResolvedValue(result);
    const pendingCallbackResult = new Promise(() => {});
    const onSuccess = vi.fn(() => pendingCallbackResult);
    const notifySaved = vi.fn();

    const savedResult = await submitOmpSkillSettings(settings, updateSettings, onSuccess);
    notifySaved();

    expect(updateSettings).toHaveBeenCalledWith(settings);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(result);
    expect(savedResult).toBe(result);
    expect(notifySaved).toHaveBeenCalledTimes(1);
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
