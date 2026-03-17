const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let configDir;
let eventBus;
let loadConfigMock;
let consoleLogSpy;
let consoleErrorSpy;

function loadPluginApi() {
  delete require.cache[require.resolve('../../../src/plugins/plugin-api')];
  return require('../../../src/plugins/plugin-api');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-api-'));
  configDir = path.join(testDir, 'plugins', 'config');
  eventBus = { emitSync: vi.fn(), on: vi.fn() };
  loadConfigMock = vi.fn(() => ({
    theme: 'dark',
    flags: { plugins: true }
  }));

  const constantsPath = require.resolve('../../../src/plugins/constants');
  require.cache[constantsPath] = {
    id: constantsPath,
    filename: constantsPath,
    loaded: true,
    exports: {
      CONFIG_DIR: configDir
    }
  };

  const eventBusPath = require.resolve('../../../src/plugins/event-bus');
  require.cache[eventBusPath] = {
    id: eventBusPath,
    filename: eventBusPath,
    loaded: true,
    exports: eventBus
  };

  const loaderPath = require.resolve('../../../src/config/loader');
  require.cache[loaderPath] = {
    id: loaderPath,
    filename: loaderPath,
    loaded: true,
    exports: {
      loadConfig: loadConfigMock
    }
  };

  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });

  [
    '../../../src/plugins/plugin-api',
    '../../../src/plugins/constants',
    '../../../src/plugins/event-bus',
    '../../../src/config/loader'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('plugin-api context and storage helpers', () => {
  test('createPluginContext exposes frozen config and validates command registration', () => {
    const { createPluginContext } = loadPluginApi();
    const ctx = createPluginContext('demo-plugin', { enabled: true }, '/tmp/demo-plugin');
    const commandHandler = vi.fn();

    expect(Object.isFrozen(ctx.config)).toBe(true);
    expect(() => {
      ctx.config.enabled = false;
    }).toThrow();
    expect(ctx.config.enabled).toBe(true);
    expect(ctx.events).toBe(eventBus);

    expect(() => ctx.registerCommand('', commandHandler)).toThrow('Command name must be a non-empty string');
    expect(() => ctx.registerCommand('demo:run', 'not-a-function')).toThrow('Command handler must be a function');

    ctx.registerCommand('demo:run', commandHandler);
    expect(ctx._getCommands().get('demo:run')).toBe(commandHandler);
  });

  test('getAppConfig returns a frozen copy of the current app config', () => {
    const { createPluginContext } = loadPluginApi();
    const ctx = createPluginContext('demo-plugin', {}, '/tmp/demo-plugin');

    const appConfig = ctx.getAppConfig();

    expect(loadConfigMock).toHaveBeenCalled();
    expect(Object.isFrozen(appConfig)).toBe(true);
    expect(() => {
      appConfig.theme = 'light';
    }).toThrow();
    expect(appConfig.theme).toBe('dark');
  });

  test('storage persists data across contexts and supports delete', () => {
    const { createPluginContext } = loadPluginApi();
    const ctxA = createPluginContext('demo-plugin', {}, '/tmp/demo-plugin');
    const ctxB = createPluginContext('demo-plugin', {}, '/tmp/demo-plugin');

    ctxA.storage.set('token', 'secret');
    ctxA.storage.set('count', 2);

    expect(ctxB.storage.get('token')).toBe('secret');
    expect(JSON.parse(fs.readFileSync(path.join(configDir, 'demo-plugin.json'), 'utf8'))).toEqual({
      token: 'secret',
      count: 2
    });

    ctxB.storage.delete('token');
    expect(ctxA.storage.get('token')).toBeUndefined();
    expect(ctxA.storage.get('count')).toBe(2);
  });

  test('storage recovers from invalid JSON by returning empty data and rewriting clean content', () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'demo-plugin.json'), '{bad json', 'utf8');
    const { createPluginContext } = loadPluginApi();
    const ctx = createPluginContext('demo-plugin', {}, '/tmp/demo-plugin');

    expect(ctx.storage.get('missing')).toBeUndefined();

    ctx.storage.set('token', 'fresh');
    expect(JSON.parse(fs.readFileSync(path.join(configDir, 'demo-plugin.json'), 'utf8'))).toEqual({
      token: 'fresh'
    });
  });
});
