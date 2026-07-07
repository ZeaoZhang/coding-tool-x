const path = require('path');
const os = require('os');

const PI_CONFIG_PATH = require.resolve('../../../src/server/services/pi-config');
const PATHS_PATH = require.resolve('../../../src/config/paths');

describe('pi-config path resolution', () => {
  const homeDir = path.join(path.sep, 'tmp', 'ctx-home');
  const commandNotFound = () => {
    throw new Error('command not found');
  };

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
    const options = { commandRunner: commandNotFound };

    expect(getPiAgentDir(env, options)).toBe(path.resolve(env.PI_CODING_AGENT_DIR));
    expect(getPiPaths(env, options)).toEqual(expect.objectContaining({
      agentDir: path.resolve(env.PI_CODING_AGENT_DIR),
      settings: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'config.yml'),
      models: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'models.yml'),
      modelsYml: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'models.yml'),
      sessions: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'sessions'),
      skills: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'skills'),
      commands: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'commands'),
      extensions: path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'extensions')
    }));
  });

  test('defaults to HOME_DIR/.omp/agent', () => {
    const { getPiAgentDir } = require('../../../src/server/services/pi-config');

    expect(getPiAgentDir({}, { commandRunner: commandNotFound })).toBe(path.resolve(homeDir, '.omp', 'agent'));
  });

  test('uses OMP_PROFILE before legacy PI_PROFILE for profile agent directories', () => {
    const { getPiAgentDir } = require('../../../src/server/services/pi-config');
    const options = { commandRunner: commandNotFound };

    expect(getPiAgentDir({ OMP_PROFILE: 'work', PI_PROFILE: 'legacy' }, options))
      .toBe(path.resolve(homeDir, '.omp', 'profiles', 'work', 'agent'));
    expect(getPiAgentDir({ PI_PROFILE: 'legacy' }, options))
      .toBe(path.resolve(homeDir, '.omp', 'profiles', 'legacy', 'agent'));
  });

  test('expands tilde paths against configured HOME_DIR', () => {
    const { getPiAgentDir } = require('../../../src/server/services/pi-config');

    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: '~/custom-pi' }, { commandRunner: commandNotFound }))
      .toBe(path.resolve(homeDir, 'custom-pi'));
  });

  test('preserves Windows-style env paths without forcing Unix home expansion', () => {
    const { getPiAgentDir } = require('../../../src/server/services/pi-config');
    const windowsPath = 'C:\\Users\\demo\\.omp\\agent';

    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: windowsPath }, { commandRunner: commandNotFound }))
      .toBe(path.resolve(windowsPath));
  });

  test('prefers omp config path over derived environment paths when OMP is available', () => {
    const { getPiAgentDir, getPiStatus } = require('../../../src/server/services/pi-config');
    const resolvedAgentDir = path.join(path.sep, 'real', 'omp', 'agent');
    const calls = [];
    const commandRunner = (command, args) => {
      calls.push([command, ...args]);
      if (command === 'omp' && args[0] === '--version') return 'omp 1.0.0\n';
      if (command === 'omp' && args[0] === 'config' && args[1] === 'path') return `${resolvedAgentDir}\n`;
      throw new Error('unexpected command');
    };
    const env = {
      PI_CODING_AGENT_DIR: path.join(path.sep, 'derived', 'agent'),
      OMP_PROFILE: 'work'
    };

    expect(getPiAgentDir(env, { commandRunner })).toBe(resolvedAgentDir);
    expect(getPiStatus(env, { commandRunner })).toEqual(expect.objectContaining({
      runtime: 'omp',
      command: 'omp',
      commandSource: 'path',
      agentDir: resolvedAgentDir,
      modelsYmlPath: path.join(resolvedAgentDir, 'models.yml')
    }));
    expect(calls).toEqual(expect.arrayContaining([
      ['omp', '--version'],
      ['omp', 'config', 'path']
    ]));
  });

  test('falls back to legacy ~/.pi/agent when only legacy pi command is available', () => {
    const { getPiAgentDir, resolvePiRuntime } = require('../../../src/server/services/pi-config');
    const commandRunner = (command, args) => {
      if (command === 'omp' && args[0] === '--version') throw new Error('missing omp');
      if (command === 'pi' && args[0] === '--version') return 'pi 0.1.0\n';
      throw new Error('unexpected command');
    };

    expect(resolvePiRuntime({}, { commandRunner })).toEqual(expect.objectContaining({
      runtime: 'pi',
      command: 'pi',
      installed: true,
      commandSource: 'path'
    }));
    expect(getPiAgentDir({}, { commandRunner })).toBe(path.resolve(homeDir, '.pi', 'agent'));
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
      settings: path.join(expectedDir, 'config.yml'),
      models: path.join(expectedDir, 'models.yml'),
      modelsYml: path.join(expectedDir, 'models.yml'),
      skills: path.join(expectedDir, 'skills'),
      commands: path.join(expectedDir, 'commands'),
      extensions: path.join(expectedDir, 'extensions'),
      packages: path.join(expectedDir, 'packages')
    }));
  });
});
