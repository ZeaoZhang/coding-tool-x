const path = require('path');

const adapterModule = '../../../src/platforms/drivers/omp/native-plugin-adapter';
const configModule = '../../../src/platforms/drivers/omp/config';

describe('OmpNativePluginAdapter operation cache', () => {
  let commandRunner;

  beforeEach(() => {
    const configPath = require.resolve(configModule);
    require.cache[configPath] = {
      id: configPath,
      filename: configPath,
      loaded: true,
      exports: {
        getOmpCommand: vi.fn(() => 'omp-test'),
        getOmpPaths: vi.fn(() => ({ extensions: path.join(process.cwd(), 'missing-extensions') }))
      }
    };
    delete require.cache[require.resolve(adapterModule)];
    commandRunner = vi.fn(() => JSON.stringify({ npm: [{ name: 'demo', version: '1.0.0' }] }));
  });

  afterEach(() => {
    delete require.cache[require.resolve(adapterModule)];
    delete require.cache[require.resolve(configModule)];
  });

  it('caches list operations by cwd and force reuses the operation cache boundary', () => {
    const { OmpNativePluginAdapter } = require(adapterModule);
    const adapter = new OmpNativePluginAdapter({ commandRunner });
    const cwd = path.join(process.cwd(), 'project-cache');

    const first = adapter.listPlugins({ cwd });
    const second = adapter.listPlugins({ cwd });
    const forced = adapter.listPlugins({ cwd, force: true });

    expect(first.plugins).toHaveLength(1);
    expect(second).toEqual(first);
    expect(forced.plugins).toHaveLength(1);
    expect(commandRunner).toHaveBeenCalledTimes(2);
  });
});
