'use strict';

const SERVICE_PATH = require.resolve('../../../src/platforms/drivers/codex/sessions-implementation');
const DRIVER_PATH = require.resolve('../../../src/platforms/drivers/codex/sessions');

afterEach(() => {
  delete require.cache[DRIVER_PATH];
  delete require.cache[SERVICE_PATH];
});

function createMockedDriver() {
  const searchSessions = vi.fn(async () => [{ sessionId: 'session-1' }]);
  require.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    loaded: true,
    exports: {
      configure: vi.fn(),
      searchSessions
    }
  };
  const { createDriver } = require(DRIVER_PATH);
  return { driver: createDriver({}), searchSessions };
}

describe('Codex project search adapter', () => {
  test('maps the descriptor request context to keyword and project scope', async () => {
    const { driver, searchSessions } = createMockedDriver();
    const result = await driver.search({
      platform: 'codex',
      params: { projectName: 'gpu-mass' },
      query: { keyword: 'needle', limit: '7', context: '12' }
    });

    expect(result.status).toBe('ok');
    expect(searchSessions).toHaveBeenCalledWith('needle', expect.objectContaining({
      projectName: 'gpu-mass',
      limit: 7,
      contextLength: 12
    }));
  });

  test('keeps the legacy keyword/options call shape working', async () => {
    const { driver, searchSessions } = createMockedDriver();
    const options = { projectName: 'legacy-project' };
    await driver.search('needle', options);

    expect(searchSessions).toHaveBeenCalledWith('needle', options);
  });

  test('defaults project search limits like the other session drivers', async () => {
    const { driver, searchSessions } = createMockedDriver();
    await driver.search({
      platform: 'codex',
      params: { projectName: 'gpu-mass' },
      query: { keyword: 'needle' }
    });

    expect(searchSessions).toHaveBeenCalledWith('needle', expect.objectContaining({
      projectName: 'gpu-mass',
      limit: 100,
      contextLength: 15
    }));
  });
});
