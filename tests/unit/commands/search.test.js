'use strict';

function createHarness(driver) {
  const registry = {
    resolve: vi.fn(key => key === 'demo-cli'
      ? { key, label: 'Demo CLI', capabilities: { sessions: 'fake', projects: 'fake' } }
      : null),
    getCapability: vi.fn((_key, capability) => ['sessions', 'projects'].includes(capability) ? 'fake' : null)
  };
  const runtime = {
    getDriver: vi.fn(() => driver)
  };
  return { registry, runtime };
}

describe('platform session search commands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('searches across projects through the selected platform Driver', async () => {
    const sessions = {
      searchAcrossProjects: vi.fn().mockResolvedValue([{
        sessionId: 's1',
        projectName: 'demo',
        matches: [],
        matchCount: 1
      }])
    };
    const { registry, runtime } = createHarness(sessions);
    const { searchSessionsAcrossProjects } = require('../../../src/commands/search');
    const config = { currentCliType: 'demo-cli' };

    const choices = await searchSessionsAcrossProjects(
      config,
      'hello',
      { limit: 10, registry, runtime }
    );

    expect(sessions.searchAcrossProjects).toHaveBeenCalledWith('hello', 10, { config });
    expect(runtime.getDriver).toHaveBeenCalledWith('demo-cli', 'sessions');
    expect(choices[0]).toMatchObject({
      value: { sessionId: 's1', projectName: 'demo' }
    });
  });

  test('returns unsupported without scanning Claude sessions', async () => {
    const sessions = {};
    const { registry, runtime } = createHarness(sessions);
    const { searchSessionsAcrossProjects } = require('../../../src/commands/search');

    const result = await searchSessionsAcrossProjects(
      { currentCliType: 'demo-cli' },
      'hello',
      { registry, runtime }
    );

    expect(result).toMatchObject({
      status: 'unsupported',
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'searchAcrossProjects'
    });
    expect(runtime.getDriver).toHaveBeenCalledTimes(1);
  });
});
