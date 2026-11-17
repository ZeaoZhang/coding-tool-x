'use strict';

const SERVICE_PATH = require.resolve('../../../src/platforms/drivers/claude/sessions-implementation');
const DRIVER_PATH = require.resolve('../../../src/platforms/drivers/claude/sessions');

afterEach(() => {
  delete require.cache[DRIVER_PATH];
  delete require.cache[SERVICE_PATH];
});

function createMockedDriver() {
  const launch = vi.fn(() => ({ status: 0, cwd: '/tmp/project' }));
  const getSessionLaunchCommand = vi.fn((sessionId, options) => ({
    command: `claude -r ${sessionId}`,
    args: ['claude', '-r', sessionId],
    cwd: options.cwd || '/tmp/project'
  }));
  require.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    loaded: true,
    exports: {
      configure: vi.fn(),
      launch,
      getSessionLaunchCommand
    }
  };
  const { createDriver } = require(DRIVER_PATH);
  return { driver: createDriver({}), launch, getSessionLaunchCommand };
}

describe('Claude session launch adapter', () => {
  test('exposes a non-blocking launch command builder', () => {
    const { driver, getSessionLaunchCommand } = createMockedDriver();
    const result = driver.launchCommand('session-1', {
      fork: true,
      config: { projectsDir: '/tmp/projects' },
      cwd: '/tmp/workspace'
    });

    expect(getSessionLaunchCommand).toHaveBeenCalledWith('session-1', {
      fork: true,
      config: { projectsDir: '/tmp/projects' },
      cwd: '/tmp/workspace'
    });
    expect(result).toEqual({
      status: 'ok',
      platform: 'claude',
      capability: 'sessions',
      operation: 'launchCommand',
      data: {
        command: 'claude -r session-1',
        args: ['claude', '-r', 'session-1'],
        cwd: '/tmp/workspace'
      }
    });
  });

  test('keeps the CLI launch call shape working', async () => {
    const { driver, launch, getSessionLaunchCommand } = createMockedDriver();
    const options = { fork: false, config: {} };
    await driver.launch('session-1', options);

    expect(launch).toHaveBeenCalledWith('session-1', options);
    expect(getSessionLaunchCommand).not.toHaveBeenCalled();
  });
});
