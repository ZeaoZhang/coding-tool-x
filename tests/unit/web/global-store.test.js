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

    store.codexChannels = [
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

    expect(store.codexChannels).toEqual([
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

    store.geminiChannels = [];
    store.handleProxyStateUpdate({
      type: 'proxy-state',
      source: 'gemini',
      proxy: { running: true },
      channels: [
        {
          id: 'gemini-1',
          name: 'Gemini Test',
          enabled: true
        }
      ]
    });

    expect(store.geminiChannels).toEqual([
      expect.not.objectContaining({
        apiKey: expect.any(String)
      })
    ]);
  });
});
