const path = require('path');
const os = require('os');

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

describe('config paths Pi native paths', () => {
  const originalPiAgentDir = process.env.PI_CODING_AGENT_DIR;

  afterEach(() => {
    if (originalPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalPiAgentDir;
    }
    delete require.cache[PATHS_PATH];
  });

  test('expands PI_CODING_AGENT_DIR for NATIVE_PATHS.pi', () => {
    process.env.PI_CODING_AGENT_DIR = '~/custom-pi-agent';
    delete require.cache[PATHS_PATH];

    const { NATIVE_PATHS, getPiAgentDir } = require('../../../src/config/paths');
    const expectedDir = path.resolve(os.homedir(), 'custom-pi-agent');

    expect(getPiAgentDir()).toBe(expectedDir);
    expect(NATIVE_PATHS.pi).toEqual(expect.objectContaining({
      dir: expectedDir,
      settings: path.join(expectedDir, 'settings.json'),
      skills: path.join(expectedDir, 'skills'),
      prompts: path.join(expectedDir, 'prompts'),
      extensions: path.join(expectedDir, 'extensions'),
      packages: path.join(expectedDir, 'packages')
    }));
  });
});
