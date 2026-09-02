const path = require('path');
const os = require('os');
const fs = require('fs');
const yaml = require('js-yaml');

const OMP_CONFIG_PATH = require.resolve('../../../src/platforms/drivers/omp/config');
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
    const { getOmpAgentDir, getOmpPaths } = require('../../../src/platforms/drivers/omp/config');
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
    const { getOmpAgentDir, getOmpPaths } = require('../../../src/platforms/drivers/omp/config');
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
    const { getOmpAgentDir } = require('../../../src/platforms/drivers/omp/config');

    expect(getOmpAgentDir({}, { commandRunner: commandNotFound })).toBe(path.resolve(homeDir, '.omp', 'agent'));
  });

  test('uses OMP_PROFILE for profile agent directories', () => {
    const { getOmpAgentDir } = require('../../../src/platforms/drivers/omp/config');
    const options = { commandRunner: commandNotFound };

    expect(getOmpAgentDir({ OMP_PROFILE: 'work' }, options))
      .toBe(path.resolve(homeDir, '.omp', 'profiles', 'work', 'agent'));
  });

  test('expands tilde paths against configured HOME_DIR', () => {
    const { getOmpAgentDir } = require('../../../src/platforms/drivers/omp/config');

    expect(getOmpAgentDir({ OMP_CODING_AGENT_DIR: '~/custom-omp' }, { commandRunner: commandNotFound }))
      .toBe(path.resolve(homeDir, 'custom-omp'));
  });

  test('preserves Windows-style env paths without forcing Unix home expansion', () => {
    const { getOmpAgentDir } = require('../../../src/platforms/drivers/omp/config');
    const windowsPath = 'C:\\Users\\demo\\.omp\\agent';

    expect(getOmpAgentDir({ OMP_CODING_AGENT_DIR: windowsPath }, { commandRunner: commandNotFound }))
      .toBe(path.resolve(windowsPath));
  });

  test('prefers omp config path over derived environment paths when OMP is available', () => {
    const { getOmpAgentDir, getOmpStatus } = require('../../../src/platforms/drivers/omp/config');
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
    const { resolveOmpRuntime } = require('../../../src/platforms/drivers/omp/config');
    const commandRunner = vi.fn(() => 'omp 1.0.0\n');

    resolveOmpRuntime({}, { commandRunner });

    expect(commandRunner).toHaveBeenCalledWith(
      'omp',
      ['--version'],
      expect.objectContaining({ windowsHide: true })
    );
  });

  test('can resolve OMP native paths without starting the CLI', () => {
    const { getOmpPaths } = require('../../../src/platforms/drivers/omp/config');
    const commandRunner = vi.fn(() => {
      throw new Error('OMP CLI must not be started for native path lookup');
    });
    const env = { OMP_CODING_AGENT_DIR: path.join(path.sep, 'native', 'omp-agent') };

    expect(getOmpPaths(env, { commandRunner, resolveRuntime: false }).agentDir)
      .toBe(path.resolve(env.OMP_CODING_AGENT_DIR));
    expect(commandRunner).not.toHaveBeenCalled();
  });

  test('can report native OMP status without starting the CLI', () => {
    const { getOmpStatus } = require('../../../src/platforms/drivers/omp/config');
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
    const { getOmpAgentDir, resolveOmpRuntime } = require('../../../src/platforms/drivers/omp/config');
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

describe('strict OMP settings persistence', () => {
  const originalPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalOmpAgentDir = process.env.OMP_CODING_AGENT_DIR;
  const originalOmpCommand = process.env.OMP_COMMAND;
  let testDir;
  let agentDir;
  let configPath;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-config-strict-'));
    agentDir = path.join(testDir, 'agent');
    configPath = path.join(agentDir, 'config.yml');
    process.env.PI_CODING_AGENT_DIR = agentDir;
    delete process.env.OMP_CODING_AGENT_DIR;
    process.env.OMP_COMMAND = `missing-omp-config-test-${process.pid}`;
    delete require.cache[OMP_CONFIG_PATH];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[OMP_CONFIG_PATH];
    fs.rmSync(testDir, { recursive: true, force: true });
    if (originalPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalPiAgentDir;
    if (originalOmpAgentDir === undefined) delete process.env.OMP_CODING_AGENT_DIR;
    else process.env.OMP_CODING_AGENT_DIR = originalOmpAgentDir;
    if (originalOmpCommand === undefined) delete process.env.OMP_COMMAND;
    else process.env.OMP_COMMAND = originalOmpCommand;
  });

  test('returns an empty object when config.yml is absent without reading legacy settings', () => {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify({ legacy: true }));
    const { readOmpSettings, readOmpSettingsStrict } = require('../../../src/platforms/drivers/omp/config');

    expect(readOmpSettingsStrict()).toEqual({});
    expect(readOmpSettings()).toEqual({ legacy: true });
  });

  test.each([
    ['damaged YAML', 'skills:\n  [broken\n'],
    ['null root', 'null\n'],
    ['array root', '[]\n'],
    ['scalar root', 'enabled\n'],
    ['empty document', '']
  ])('rejects %s instead of applying the legacy fallback', (_label, source) => {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(configPath, source, 'utf8');
    fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify({ legacy: true }));
    const { readOmpSettings, readOmpSettingsStrict } = require('../../../src/platforms/drivers/omp/config');

    expect(() => readOmpSettingsStrict()).toThrow();
    expect(readOmpSettings()).toEqual({ legacy: true });
  });

  test('propagates the original config.yml read error', () => {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(configPath, 'skills: {}\n', 'utf8');
    const readError = new Error('read denied');
    const originalReadFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...args) => {
      if (path.resolve(filePath) === path.resolve(configPath)) throw readError;
      return originalReadFileSync(filePath, ...args);
    });
    const { readOmpSettingsStrict } = require('../../../src/platforms/drivers/omp/config');

    expect(() => readOmpSettingsStrict()).toThrow(readError);
  });

  test('atomically writes YAML with exclusive temporary creation and preserves mode', () => {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(configPath, 'skills:\n  enablePiUser: true\n', { mode: 0o640 });
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const chmodSpy = vi.spyOn(fs, 'chmodSync');
    const renameSpy = vi.spyOn(fs, 'renameSync');
    const { writeOmpSettingsAtomic } = require('../../../src/platforms/drivers/omp/config');

    writeOmpSettingsAtomic({ skills: { enablePiUser: false } });

    const temporaryWrite = writeSpy.mock.calls.find(([filePath]) => filePath !== configPath);
    expect(temporaryWrite[2]).toMatchObject({ encoding: 'utf8', flag: 'wx', mode: 0o640 });
    expect(chmodSpy).toHaveBeenCalledWith(temporaryWrite[0], 0o640);
    expect(renameSpy).toHaveBeenCalledWith(temporaryWrite[0], configPath);
    expect(yaml.load(fs.readFileSync(configPath, 'utf8'))).toEqual({
      skills: { enablePiUser: false }
    });
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(agentDir)).toEqual(['config.yml']);
  });

  test('creates config.yml with mode 0600', () => {
    const { writeOmpSettingsAtomic } = require('../../../src/platforms/drivers/omp/config');

    writeOmpSettingsAtomic({ skills: { enablePiUser: false } });

    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    expect(yaml.load(fs.readFileSync(configPath, 'utf8'))).toEqual({
      skills: { enablePiUser: false }
    });
  });

  test('keeps original bytes, cleans the temporary file, and rethrows a rename error', () => {
    fs.mkdirSync(agentDir, { recursive: true });
    const original = Buffer.from('skills:\n  enablePiUser: true\n');
    fs.writeFileSync(configPath, original);
    const renameError = new Error('rename failed');
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw renameError;
    });
    const { writeOmpSettingsAtomic } = require('../../../src/platforms/drivers/omp/config');

    expect(() => writeOmpSettingsAtomic({ skills: { enablePiUser: false } })).toThrow(renameError);
    expect(fs.readFileSync(configPath)).toEqual(original);
    expect(fs.readdirSync(agentDir)).toEqual(['config.yml']);
  });

  test('preserves the rename error when best-effort cleanup also fails', () => {
    fs.mkdirSync(agentDir, { recursive: true });
    const original = Buffer.from('skills:\n  enablePiUser: true\n');
    fs.writeFileSync(configPath, original);
    const renameError = new Error('rename failed');
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw renameError;
    });
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw new Error('cleanup failed');
    });
    const { writeOmpSettingsAtomic } = require('../../../src/platforms/drivers/omp/config');

    try {
      expect(() => writeOmpSettingsAtomic({ skills: { enablePiUser: false } })).toThrow(renameError);
      expect(fs.readFileSync(configPath)).toEqual(original);
      expect(fs.readdirSync(agentDir)).toHaveLength(2);
    } finally {
      unlinkSpy.mockRestore();
      for (const entry of fs.readdirSync(agentDir)) {
        if (entry !== path.basename(configPath)) fs.unlinkSync(path.join(agentDir, entry));
      }
    }
  });

  test('keeps legacy readOmpSettings and writeOmpSettings behavior', () => {
    const { readOmpSettings, writeOmpSettings } = require('../../../src/platforms/drivers/omp/config');

    writeOmpSettings({ skills: { enabled: true } });

    expect(readOmpSettings()).toEqual({ skills: { enabled: true } });
  });
});
