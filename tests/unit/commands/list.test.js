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

describe('platform session list commands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('lists recent sessions through the selected platform Driver', async () => {
    const sessions = {
      recent: vi.fn().mockResolvedValue([{
        sessionId: 's1',
        projectName: 'demo',
        projectDisplayName: 'Demo',
        firstMessage: 'hello',
        mtime: Date.now(),
        size: 12
      }])
    };
    const { registry, runtime } = createHarness(sessions);
    const { listRecentSessionsAcrossProjects } = require('../../../src/commands/list');
    const config = { currentCliType: 'demo-cli', maxDisplaySessions: 10 };

    const choices = await listRecentSessionsAcrossProjects(config, 10, { registry, runtime });

    expect(sessions.recent).toHaveBeenCalledWith(10, { config });
    expect(runtime.getDriver).toHaveBeenCalledWith('demo-cli', 'sessions');
    expect(choices[0]).toMatchObject({
      value: { sessionId: 's1', projectName: 'demo' }
    });
  });

  test('lists project sessions through the selected platform Driver', async () => {
    const sessions = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [{
          sessionId: 's2',
          firstMessage: 'project session',
          mtime: Date.now(),
          size: 24
        }]
      })
    };
    const { registry, runtime } = createHarness(sessions);
    const { listSessions } = require('../../../src/commands/list');
    const config = { currentCliType: 'demo-cli', currentProject: 'demo', maxDisplaySessions: 10 };

    const choices = await listSessions(config, null, { registry, runtime });

    expect(sessions.listSessions).toHaveBeenCalledWith('demo', { config });
    expect(choices[0]).toMatchObject({ value: 's2' });
  });

  test('returns unsupported without falling back to Claude sessions', async () => {
    const sessions = {};
    const { registry, runtime } = createHarness(sessions);
    const { listRecentSessionsAcrossProjects } = require('../../../src/commands/list');

    const result = await listRecentSessionsAcrossProjects(
      { currentCliType: 'demo-cli' },
      5,
      { registry, runtime }
    );

    expect(result).toMatchObject({
      status: 'unsupported',
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'recent'
    });
    expect(runtime.getDriver).toHaveBeenCalledTimes(1);
  });
});
