const path = require('path');

const PI_CONFIG_PATH = require.resolve('../../../src/server/services/pi-config');
const PATHS_PATH = require.resolve('../../../src/config/paths');

describe('pi-config path resolution', () => {
  const homeDir = path.join(path.sep, 'tmp', 'ctx-home');

  beforeEach(() => {
    delete require.cache[PI_CONFIG_PATH];
    require.cache[PATHS_PATH] = {
      id: PATHS_PATH,
      filename: PATHS_PATH,
      loaded: true,
      exports: {
        HOME_DIR: homeDir
      }
    };
  });

  afterEach(() => {
    delete require.cache[PI_CONFIG_PATH];
    delete require.cache[PATHS_PATH];
  });

  test('uses PI_CODING_AGENT_DIR when provided', () => {
    const { getPiAgentDir, getPiPaths } = require('../../../src/server/services/pi-config');
    const env = { PI_CODING_AGENT_DIR: path.join(path.sep, 'custom', 'pi-agent') };

    expect(getPiAgentDir(env)).toBe(path.resolve(env.PI_CODING_AGENT_DIR));
    expect(getPiPaths(env)).toEqual(expect.objectContaining({
      agentDir: path.resolve(env.PI_CODING_AGENT_DIR),
      settings: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'settings.json'),
      sessions: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'sessions'),
      skills: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'skills'),
      prompts: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'prompts'),
      extensions: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'extensions')
    }));
  });

  test('defaults to HOME_DIR/.pi/agent', () => {
    const { getPiAgentDir } = require('../../../src/server/services/pi-config');

    expect(getPiAgentDir({})).toBe(path.resolve(homeDir, '.pi', 'agent'));
  });

  test('expands tilde paths against configured HOME_DIR', () => {
    const { getPiAgentDir } = require('../../../src/server/services/pi-config');

    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: '~/custom-pi' }))
      .toBe(path.resolve(homeDir, 'custom-pi'));
  });

  test('preserves Windows-style env paths without forcing Unix home expansion', () => {
    const { getPiAgentDir } = require('../../../src/server/services/pi-config');
    const windowsPath = 'C:\\Users\\demo\\.pi\\agent';

    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: windowsPath })).toBe(path.resolve(windowsPath));
  });
});
