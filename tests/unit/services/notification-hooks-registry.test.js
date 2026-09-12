
const { catalog, drivers, loadUIConfig, saveUIConfig } = vi.hoisted(() => {
  const driverFor = (key, status, definition) => ({
    platform: key,
    capability: 'hooks',
    getHooks: vi.fn(() => status),
    saveHooks: vi.fn(),
    testHooks: vi.fn(),
    getDefinition: vi.fn(() => definition)
  });
  const statuses = {
    claude: { enabled: false, external: false, type: 'notification', method: 'Stop Hook' },
    demo: { enabled: true, external: false, type: 'dialog', method: 'Demo Hook' }
  };
  const definitions = {
    claude: {
      key: 'claude',
      label: 'Adapter Claude',
      description: 'Claude description',
      implementation: 'Claude implementation',
      externalMessage: 'Claude external',
      hints: ['Claude hint']
    },
    demo: {
      key: 'demo',
      label: 'Adapter Demo',
      description: 'Demo description',
      implementation: 'Demo implementation',
      externalMessage: 'Demo external',
      hints: ['Demo hint']
    }
  };
  const drivers = {
    claude: driverFor('claude', statuses.claude, definitions.claude),
    demo: driverFor('demo', statuses.demo, definitions.demo)
  };
  const catalog = {
    list: vi.fn(() => [
      { key: 'claude', label: 'Manifest Claude' },
      { key: 'demo', label: 'Manifest Demo' },
      { key: 'missing', label: 'Manifest Missing' }
    ]),
    driver: vi.fn(key => drivers[key] || null)
  };
  return {
    catalog,
    drivers,
    loadUIConfig: vi.fn(() => ({})),
    saveUIConfig: vi.fn()
  };
});

vi.mock('../../../src/server/services/platform-catalog', () => ({
  getPlatformCatalog: vi.fn(() => catalog)
}));
vi.mock('../../../src/server/services/ui-config', () => ({ loadUIConfig, saveUIConfig }));
vi.mock('../../../src/config/paths', () => ({
  PATHS: { notifyHook: '/tmp/notification-hooks-registry-test/notify-hook.js' },
  NATIVE_PATHS: {
    claude: { settings: '/tmp/notification-hooks-registry-test/claude.json' },
    codex: { config: '/tmp/notification-hooks-registry-test/codex.toml' },
    gemini: { env: '/tmp/notification-hooks-registry-test/gemini.env' },
    opencode: { config: '/tmp/notification-hooks-registry-test/opencode' },
    omp: { extensions: '/tmp/notification-hooks-registry-test/extensions' }
  }
}));

const notificationHooks = require('../../../src/platforms/notification-hooks');
const providerRegistryModule = require('../../../src/platforms/remote-notification-providers');

describe('notification hooks catalog integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadUIConfig.mockReturnValue({});
  });

  it('lists only complete discovered hook drivers and uses manifest labels', () => {
    const result = notificationHooks.getNotificationSettings({ catalog });

    expect(result.platforms).toEqual({
      claude: { enabled: false, external: false, type: 'notification', method: 'Stop Hook' },
      demo: { enabled: true, external: false, type: 'dialog', method: 'Demo Hook' }
    });
    expect(result.platformDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'demo',
        label: 'Manifest Demo',
        description: 'Demo description',
        implementation: 'Demo implementation',
        hints: ['Demo hint']
      })
    ]));
    expect(result.platformDefinitions).toHaveLength(2);
    expect(result.stopHook).toEqual({ enabled: false, type: 'notification' });
    expect(catalog.driver).toHaveBeenCalledWith('missing', 'hooks');
  });

  it('saves only discovered platform keys and ignores unknown input', () => {
    notificationHooks.saveNotificationSettings({
      platforms: {
        claude: { enabled: false, type: 'notification' },
        demo: { enabled: true, type: 'browser' },
        unknown: { enabled: true, type: 'dialog' }
      },
      remoteNotifications: { providers: [] }
    }, { catalog });

    expect(drivers.claude.saveHooks).toHaveBeenCalledWith({ enabled: false, type: 'notification' });
    expect(drivers.demo.saveHooks).toHaveBeenCalledWith({ enabled: true, type: 'browser' });
    expect(drivers.claude.saveHooks).toHaveBeenCalledTimes(1);
    expect(drivers.demo.saveHooks).toHaveBeenCalledTimes(1);
  });
  it('accepts legacy stopHook input while preserving dynamic platform keys', () => {
    notificationHooks.saveNotificationSettings({
      stopHook: { enabled: true, type: 'browser' },
      remoteNotifications: { providers: [] }
    }, { catalog });

    expect(drivers.claude.saveHooks).toHaveBeenCalledWith({ enabled: true, type: 'browser' });
    expect(drivers.demo.saveHooks).toHaveBeenCalledWith({ enabled: false, type: 'notification' });
  });
});

describe('remote notification provider registry', () => {
  it('publishes safe field descriptors without sender functions or secret values', () => {
    const descriptors = providerRegistryModule.getRemoteProviderTypes();
    expect(descriptors).toHaveLength(6);
    for (const descriptor of descriptors) {
      expect(descriptor).not.toHaveProperty('send');
      expect(descriptor).not.toHaveProperty('validate');
      for (const field of descriptor.fields) {
        expect(['input', 'secret', 'select']).toContain(field.type);
        expect(Object.keys(field)).toEqual(expect.arrayContaining(['key', 'label', 'type']));
        expect(Object.keys(field)).not.toContain('send');
      }
    }
    const dingTalk = descriptors.find(item => item.type === 'dingtalkBot');
    expect(dingTalk.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'clientSecret',
        type: 'secret',
        visibleWhen: { key: 'mode', equals: 'app' }
      })
    ]));
  });

  it('supports trusted provider registration and dispatches normalized test input', async () => {
    const send = vi.fn(() => ({ delivered: true }));
    const registry = providerRegistryModule.createRemoteNotificationProviderRegistry();
    registry.register('testProvider', {
      label: 'Test Provider',
      description: 'Test',
      hint: 'Test hint',
      defaults: { token: 'secret-default', unused: 'should-not-be-public' },
      fields: [{ key: 'token', label: 'Token', type: 'secret' }],
      normalize: config => ({ token: String(config?.token || '').trim() }),
      validate: config => {
        if (!config.token) throw new Error('missing token');
      },
      send
    });
    const publicDescriptor = registry.list().find(item => item.type === 'testProvider');
    expect(publicDescriptor.defaults).toEqual({ token: '' });

    const result = await registry.sendTest({
      type: 'testProvider',
      name: 'Test',
      config: { token: ' value ' }
    });

    expect(result).toEqual({ delivered: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'testProvider',
      config: { token: 'value' },
      enabled: true
    }));
  });
});
