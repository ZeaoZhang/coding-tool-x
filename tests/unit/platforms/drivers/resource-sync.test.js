'use strict';

describe('resourceSync Driver contracts', () => {
  test.each([
    ['claude', 'syncToClaude', 'removeFromClaude'],
    ['codex', 'syncToCodex', 'removeFromCodex'],
    ['gemini', 'syncToGemini', 'removeFromGemini'],
    ['opencode', 'syncToOpenCode', 'removeFromOpenCode'],
    ['omp', 'syncToOmp', 'removeFromOmp']
  ])('%s delegates to native ConfigSyncManager methods', (platform, syncMethod, removeMethod) => {
    const calls = [];
    const manager = { [syncMethod]: (...args) => { calls.push([syncMethod, args]); return { success: true }; }, [removeMethod]: (...args) => { calls.push([removeMethod, args]); return { success: true }; } };
    const driver = require(`../../../../src/platforms/drivers/${platform}/resource-sync`).createDriver({ requireImpl: () => ({ ConfigSyncManager: function ConfigSyncManager() { return manager; } }) });
    expect(driver.sync('skills', 'demo')).toMatchObject({ status: 'ok', platform, capability: 'resourceSync', data: { success: true } });
    expect(driver.remove('skills', 'demo')).toMatchObject({ status: 'ok', platform, capability: 'resourceSync', data: { success: true } });
    expect(calls).toEqual([[syncMethod, ['skills', 'demo']], [removeMethod, ['skills', 'demo']]]);
  });
});
