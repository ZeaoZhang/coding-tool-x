'use strict';

const platforms = ['claude', 'codex', 'gemini', 'opencode', 'omp'];

function serviceFor(platform, channels = []) {
  const list = platform === 'claude' ? () => channels : () => ({ channels });
  const syncName = {
    claude: 'syncCurrentClaudeChannel',
    codex: 'syncCurrentCodexChannel',
    gemini: 'syncCurrentGeminiChannel',
    opencode: 'syncCurrentOpenCodeChannel',
    omp: 'syncCurrentOmpChannel'
  }[platform];
  return {
    [platform === 'claude' ? 'getAllChannels' : 'getChannels']: list,
    getEnabledChannels: () => channels,
    createChannel: input => input,
    updateChannel: (id, patch) => ({ id, ...patch }),
    deleteChannel: id => ({ success: true, id }),
    markChannelAsRecentlyUsed: id => ({ id }),
    applyChannelToSettings: id => ({ id }),
    getEffectiveApiKey: channel => channel.apiKey || null,
    disableAllChannels: () => undefined,
    [syncName]: () => ({ synced: true })
  };
}

describe('built-in channel Driver contract', () => {
  test.each(platforms)('%s exposes the stable channel operations', platform => {
    const driverModule = require(`../../../src/platforms/drivers/${platform}/channels`);
    const servicePath = {
      claude: './claude/channels-implementation',
      codex: './codex/channels-implementation',
      gemini: './gemini/channels-implementation',
      opencode: './opencode/channels-implementation',
      omp: './omp/channels-implementation'
    }[platform];
    const driver = driverModule.createDriver({
      requireImpl: requested => requested === servicePath ? serviceFor(platform) : null
    });

    for (const operation of ['list', 'getEnabled', 'create', 'update', 'remove', 'syncCurrent', 'applyNativeConfig', 'getEffectiveApiKey', 'disableAll']) {
      expect(typeof driver[operation]).toBe('function');
    }
  });

  test('returns sanitized channel DTOs with platform extensions in extra', () => {
    const { createDriver } = require('../../../src/platforms/drivers/claude/channels');
    const driver = createDriver({
      requireImpl: () => serviceFor('claude', [{ id: 'one', name: 'One', apiKey: 'secret', customFlag: true }])
    });

    const result = driver.list();
    expect(result).toMatchObject({ status: 'ok', platform: 'claude', capability: 'channels', operation: 'list' });
    expect(result.data.channels[0]).toEqual({ id: 'one', name: 'One', extra: { customFlag: true } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  test.each(platforms)('%s reports invalid input with operation context', platform => {
    const driverModule = require(`../../../src/platforms/drivers/${platform}/channels`);
    const driver = driverModule.createDriver({ requireImpl: () => serviceFor(platform) });
    expect(driver.update('', null)).toEqual(expect.objectContaining({
      status: 'invalid', platform, capability: 'channels', operation: 'update'
    }));
  });

  test('preserves native failures as non-enumerable causes', () => {
    const { createDriver } = require('../../../src/platforms/drivers/codex/channels');
    const cause = new Error('native storage unavailable');
    const driver = createDriver({
      requireImpl: () => ({ getChannels: () => { throw cause; } })
    });
    const result = driver.list();
    expect(result).toMatchObject({ status: 'failed', platform: 'codex', capability: 'channels', operation: 'list' });
    expect(result.cause).toBe(cause);
    expect(Object.keys(result)).not.toContain('cause');
  });

  test('resolves every built-in manifest capability through Runtime', () => {
    const { getPlatformRuntime } = require('../../../src/platforms/runtime');
    const runtime = getPlatformRuntime();
    for (const platform of platforms) {
      for (const capability of ['channels', 'proxy', 'sessions']) {
        expect(runtime.getDriver(platform, capability)).toBeTruthy();
      }
      expect(runtime.getDriver(platform, 'does-not-exist')).toBeNull();
    }
  });
});
