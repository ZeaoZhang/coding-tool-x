'use strict';

let createPinia;
let setActivePinia;
let useGlobalStore;

beforeAll(async () => {
  ({ createPinia, setActivePinia } = await import('../../../src/web/node_modules/pinia/dist/pinia.mjs'));
  ({ useGlobalStore } = await import('../../../src/web/src/stores/global.js'));
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('global web store proxy channel state', () => {
  test('keeps existing api keys when proxy-state channels are sanitized', () => {
    const store = useGlobalStore();
    const channels = store.getChannels('codex');
    channels.value = [
      {
        id: 'codex-1',
        name: 'Codex Test',
        apiKey: 'sk-test-secret',
        enabled: true,
        weight: 1,
        updatedAt: 1000
      }
    ];

    store.handleProxyStateUpdate({
      type: 'proxy-state',
      source: 'codex',
      proxy: { running: true },
      activeChannel: { id: 'codex-1', name: 'Codex Test', enabled: true },
      channels: [
        {
          id: 'codex-1',
          name: 'Codex Test',
          enabled: false,
          weight: 2,
          updatedAt: 2000
        }
      ]
    });

    expect(store.getChannels('codex').value).toEqual([
      expect.objectContaining({
        id: 'codex-1',
        apiKey: 'sk-test-secret',
        enabled: false,
        weight: 2,
        updatedAt: 2000
      })
    ]);
  });

  test('does not invent api keys for channels that never had one loaded', () => {
    const store = useGlobalStore();
    const channels = store.getChannels('codex');
    channels.value = [];

    store.handleProxyStateUpdate({
      type: 'proxy-state',
      source: 'codex',
      proxy: { running: true },
      channels: [
        {
          id: 'codex-1',
          name: 'Codex Test',
          enabled: true
        }
      ]
    });

    expect(store.getChannels('codex').value).toEqual([
      expect.not.objectContaining({
        apiKey: expect.any(String)
      })
    ]);
  });

  test('hydrates keyed enabled channel state from the dashboard', () => {
    const store = useGlobalStore();
    store.hydrateFromDashboard({
      channels: {
        claude: [{ id: 'claude-1', name: 'Claude' }],
        codex: [{ id: 'codex-1', name: 'Codex' }],
        gemini: [{ id: 'gemini-1', name: 'Gemini' }],
        opencode: [{ id: 'opencode-1', name: 'OpenCode' }],
        omp: [{ id: 'omp-1', name: 'OMP' }]
      },
      proxyStatus: {}
    });

    expect(store.dashboardHydrated).toBe(true);
    expect({
      claude: store.getChannels('claude').value,
      codex: store.getChannels('codex').value,
      opencode: store.getChannels('opencode').value,
      omp: store.getChannels('omp').value
    }).toEqual({
      claude: [{ id: 'claude-1', name: 'Claude' }],
      codex: [{ id: 'codex-1', name: 'Codex' }],
      opencode: [{ id: 'opencode-1', name: 'OpenCode' }],
      omp: [{ id: 'omp-1', name: 'OMP' }]
    });
    expect(store.getChannels('gemini')).toBeNull();
  });
});
