const path = require('path');
const os = require('os');

const OMP_CONFIG_PATH = require.resolve('../../../src/server/services/omp-config');
const PATHS_PATH = require.resolve('../../../src/config/paths');

describe('omp-config path resolution', () => {
  const homeDir = path.join(path.sep, 'tmp', 'ctx-home');
  const commandNotFound = () => {
    throw new Error('command not found');
  };

  beforeEach(() => {
    delete require.cache[OMP_CONFIG_PATH];
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
    delete require.cache[OMP_CONFIG_PATH];
    delete require.cache[PATHS_PATH];
  });

  test('uses OMP_CODING_AGENT_DIR when provided', () => {
    const { getOmpAgentDir, getOmpPaths } = require('../../../src/server/services/omp-config');
    const env = { OMP_CODING_AGENT_DIR: path.join(path.sep, 'custom', 'omp-agent') };
    const options = { commandRunner: commandNotFound };

    expect(getOmpAgentDir(env, options)).toBe(path.resolve(env.OMP_CODING_AGENT_DIR));
    expect(getOmpPaths(env, options)).toEqual(expect.objectContaining({
      agentDir: path.resolve(env.OMP_CODING_AGENT_DIR),
      settings: path.join(path.resolve(env.OMP_CODING_AGENT_DIR), 'config.yml'),
      models: path.join(path.resolve(env.OMP_CODING_AGENT_DIR), 'models.yml'),
      modelsYml: path.join(path.resolve(env.OMP_CODING_AGENT_DIR), 'models.yml'),
      sessions: path.join(path.resolve(env.OMP_CODING_AGENT_DIR), 'sessions'),
      skills: path.join(path.resolve(env.OMP_CODING_AGENT_DIR), 'skills'),
      commands: path.join(path.resolve(env.OMP_CODING_AGENT_DIR), 'commands'),
      extensions: path.join(path.resolve(env.OMP_CODING_AGENT_DIR), 'extensions')
    }));
  });

  test('prefers PI_CODING_AGENT_DIR over the legacy OMP_CODING_AGENT_DIR fallback', () => {
    const { getOmpAgentDir, getOmpPaths } = require('../../../src/server/services/omp-config');
    const env = {
      PI_CODING_AGENT_DIR: path.join(path.sep, 'canonical', 'omp-agent'),
      OMP_CODING_AGENT_DIR: path.join(path.sep, 'legacy', 'omp-agent')
    };
    const options = { commandRunner: commandNotFound };

    expect(getOmpAgentDir(env, options)).toBe(path.resolve(env.PI_CODING_AGENT_DIR));
    expect(getOmpPaths(env, options).skills)
      .toBe(path.join(path.resolve(env.PI_CODING_AGENT_DIR), 'skills'));
  });

  test('defaults to HOME_DIR/.omp/agent', () => {
    const { getOmpAgentDir } = require('../../../src/server/services/omp-config');

    expect(getOmpAgentDir({}, { commandRunner: commandNotFound })).toBe(path.resolve(homeDir, '.omp', 'agent'));
  });

  test('uses OMP_PROFILE for profile agent directories', () => {
    const { getOmpAgentDir } = require('../../../src/server/services/omp-config');
    const options = { commandRunner: commandNotFound };

    expect(getOmpAgentDir({ OMP_PROFILE: 'work' }, options))
      .toBe(path.resolve(homeDir, '.omp', 'profiles', 'work', 'agent'));
  });

  test('expands tilde paths against configured HOME_DIR', () => {
    const { getOmpAgentDir } = require('../../../src/server/services/omp-config');

    expect(getOmpAgentDir({ OMP_CODING_AGENT_DIR: '~/custom-omp' }, { commandRunner: commandNotFound }))
      .toBe(path.resolve(homeDir, 'custom-omp'));
  });

  test('preserves Windows-style env paths without forcing Unix home expansion', () => {
    const { getOmpAgentDir } = require('../../../src/server/services/omp-config');
    const windowsPath = 'C:\\Users\\demo\\.omp\\agent';

    expect(getOmpAgentDir({ OMP_CODING_AGENT_DIR: windowsPath }, { commandRunner: commandNotFound }))
      .toBe(path.resolve(windowsPath));
  });

  test('prefers omp config path over derived environment paths when OMP is available', () => {
    const { getOmpAgentDir, getOmpStatus } = require('../../../src/server/services/omp-config');
    const resolvedAgentDir = path.join(path.sep, 'real', 'omp', 'agent');
    const calls = [];
    const commandRunner = (command, args) => {
      calls.push([command, ...args]);
      if (command === 'omp' && args[0] === '--version') return 'omp 1.0.0\n';
      if (command === 'omp' && args[0] === 'config' && args[1] === 'path') return `${resolvedAgentDir}\n`;
      throw new Error('unexpected command');
    };
    const env = {
      OMP_CODING_AGENT_DIR: path.join(path.sep, 'derived', 'agent'),
      OMP_PROFILE: 'work'
    };

    expect(getOmpAgentDir(env, { commandRunner })).toBe(resolvedAgentDir);
    expect(getOmpStatus(env, { commandRunner })).toEqual(expect.objectContaining({
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

  test('hides Windows command windows while probing the OMP runtime', () => {
    const { resolveOmpRuntime } = require('../../../src/server/services/omp-config');
    const commandRunner = vi.fn(() => 'omp 1.0.0\n');

    resolveOmpRuntime({}, { commandRunner });

    expect(commandRunner).toHaveBeenCalledWith(
      'omp',
      ['--version'],
      expect.objectContaining({ windowsHide: true })
    );
  });

  test('can resolve OMP native paths without starting the CLI', () => {
    const { getOmpPaths } = require('../../../src/server/services/omp-config');
    const commandRunner = vi.fn(() => {
      throw new Error('OMP CLI must not be started for native path lookup');
    });
    const env = { OMP_CODING_AGENT_DIR: path.join(path.sep, 'native', 'omp-agent') };

    expect(getOmpPaths(env, { commandRunner, resolveRuntime: false }).agentDir)
      .toBe(path.resolve(env.OMP_CODING_AGENT_DIR));
    expect(commandRunner).not.toHaveBeenCalled();
  });

  test('can report native OMP status without starting the CLI', () => {
    const { getOmpStatus } = require('../../../src/server/services/omp-config');
    const commandRunner = vi.fn(() => {
      throw new Error('OMP CLI must not be started for native status');
    });
    const env = { OMP_CODING_AGENT_DIR: path.join(path.sep, 'native', 'omp-agent') };

    expect(getOmpStatus(env, { commandRunner, resolveRuntime: false })).toEqual(expect.objectContaining({
      installed: false,
      commandSource: 'not-probed',
      agentDir: path.resolve(env.OMP_CODING_AGENT_DIR)
    }));
    expect(commandRunner).not.toHaveBeenCalled();
  });

  test('falls back to ~/.omp/agent when OMP command is unavailable', () => {
    const { getOmpAgentDir, resolveOmpRuntime } = require('../../../src/server/services/omp-config');
    const commandRunner = (command, args) => {
      if (command === 'omp' && args[0] === '--version') throw new Error('missing omp');
      throw new Error('unexpected command');
    };

    expect(resolveOmpRuntime({}, { commandRunner })).toEqual(expect.objectContaining({
      runtime: 'omp',
      command: 'omp',
      installed: false,
      commandSource: 'fallback'
    }));
    expect(getOmpAgentDir({}, { commandRunner })).toBe(path.resolve(homeDir, '.omp', 'agent'));
  });
});

describe('config paths OMP native paths', () => {
  const originalOmpAgentDir = process.env.OMP_CODING_AGENT_DIR;
  const originalPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalOmpCommand = process.env.OMP_COMMAND;

  afterEach(() => {
    if (originalOmpAgentDir === undefined) {
      delete process.env.OMP_CODING_AGENT_DIR;
    } else {
      process.env.OMP_CODING_AGENT_DIR = originalOmpAgentDir;
    }
    if (originalPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalPiAgentDir;
    }
    if (originalOmpCommand === undefined) {
      delete process.env.OMP_COMMAND;
    } else {
      process.env.OMP_COMMAND = originalOmpCommand;
    }
    delete require.cache[PATHS_PATH];
  });

  test('expands OMP_CODING_AGENT_DIR for NATIVE_PATHS.omp', () => {
    delete process.env.PI_CODING_AGENT_DIR;
    process.env.OMP_CODING_AGENT_DIR = '~/custom-omp-agent';
    process.env.OMP_COMMAND = `missing-omp-paths-test-${process.pid}`;
    delete require.cache[PATHS_PATH];

    const { NATIVE_PATHS, getOmpAgentDir } = require('../../../src/config/paths');
    const expectedDir = path.resolve(os.homedir(), 'custom-omp-agent');

    expect(getOmpAgentDir()).toBe(expectedDir);
    expect(NATIVE_PATHS.omp).toEqual(expect.objectContaining({
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

  test('getOmpAgentDir prefers omp config path over environment fallbacks', () => {
    process.env.OMP_COMMAND = `missing-omp-paths-test-${process.pid}`;
    delete require.cache[PATHS_PATH];
    const { getOmpAgentDir } = require('../../../src/config/paths');
    const cliPath = path.join(path.sep, 'cli', 'omp-agent');
    const commandRunner = vi.fn(() => `${cliPath}\n`);

    expect(getOmpAgentDir({
      OMP_COMMAND: 'custom-omp',
      PI_CODING_AGENT_DIR: path.join(path.sep, 'fallback', 'omp-agent')
    }, { commandRunner })).toBe(cliPath);
    expect(commandRunner).toHaveBeenCalledWith(
      'custom-omp',
      ['config', 'path'],
      expect.objectContaining({ windowsHide: true })
    );
  });
});
