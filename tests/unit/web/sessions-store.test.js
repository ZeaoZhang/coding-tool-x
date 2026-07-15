'use strict';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getProjects: vi.fn(),
    getSessions: vi.fn(),
    saveProjectOrder: vi.fn(),
    deleteProject: vi.fn(),
    setAlias: vi.fn(),
    deleteAlias: vi.fn(),
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
    forkSession: vi.fn(),
    saveSessionOrder: vi.fn()
  }
}));

vi.mock('../../../src/web/src/api/projects.js', () => ({
  getProjects: mocks.getProjects,
  saveProjectOrder: mocks.saveProjectOrder,
  deleteProject: mocks.deleteProject
}));

vi.mock('../../../src/web/src/api/sessions.js', () => ({
  getSessions: mocks.getSessions,
  setAlias: mocks.setAlias,
  deleteAlias: mocks.deleteAlias,
  deleteSession: mocks.deleteSession,
  deleteSessions: mocks.deleteSessions,
  forkSession: mocks.forkSession,
  saveSessionOrder: mocks.saveSessionOrder
}));

let createPinia;
let setActivePinia;
let useSessionsStore;

beforeAll(async () => {
  ({ createPinia, setActivePinia } = await import('../../../src/web/node_modules/pinia/dist/pinia.mjs'));
  ({ useSessionsStore } = await import('../../../src/web/src/stores/sessions.js'));
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('sessions store background refresh', () => {
  test('keeps polling a pending project snapshot until the long-task deadline', async () => {
    mocks.getProjects.mockResolvedValue({
      projects: [],
      currentProject: null,
      meta: { refreshing: true, fallback: true, stale: true, error: null }
    });
    const store = useSessionsStore();

    const loadPromise = store.fetchProjects({ force: true });
    await loadPromise;
    await vi.advanceTimersByTimeAsync(50000);

    expect(mocks.getProjects.mock.calls.length).toBeGreaterThan(4);
    expect(store.projectsPending).toBe(true);
  });

  test('turns an overlong project refresh into a recoverable error', async () => {
    mocks.getProjects.mockResolvedValue({
      projects: [],
      currentProject: null,
      meta: { refreshing: true, fallback: true, stale: true, error: null }
    });
    const store = useSessionsStore();

    await store.fetchProjects({ force: true });
    await vi.advanceTimersByTimeAsync(185001);

    expect(store.projectsPending).toBe(false);
    expect(store.error).toBe('项目列表生成超时，请重试');
    expect(store.projectsMeta).toEqual(expect.objectContaining({
      refreshing: false,
      error: '项目列表生成超时，请重试'
    }));
  });

  test('surfaces snapshot metadata errors instead of treating them as an empty list', async () => {
    mocks.getSessions.mockResolvedValue({
      sessions: [],
      aliases: {},
      totalSize: 0,
      projectInfo: null,
      meta: { refreshing: false, fallback: true, stale: true, error: 'CLI 扫描失败' }
    });
    const store = useSessionsStore();

    await store.fetchSessions('project-a', { force: true });

    expect(store.error).toBe('CLI 扫描失败');
    expect(store.sessionsMeta).toEqual(expect.objectContaining({ error: 'CLI 扫描失败' }));
    expect(store.sessionsPending).toBe(false);
  });
});
