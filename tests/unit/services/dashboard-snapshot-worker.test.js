const workerPath = '../../../src/server/services/dashboard-snapshot-worker.js';
const runtimeModule = require('../../../src/platforms/runtime');
let worker = require(workerPath);

describe('dashboard-snapshot-worker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('child_process');
    delete require.cache[require.resolve(workerPath)];
    worker = require(workerPath);
  });

  it('uses the default platform runtime when no test runtime is injected', async () => {
    const listProjects = vi.fn(async () => [{ name: 'demo-project', lastUsed: 10 }]);
    vi.spyOn(runtimeModule, 'getPlatformRuntime').mockReturnValue({
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { listProjects };
      })
    });

    const result = await worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config: { currentProject: 'demo-project' },
      options: { force: false }
    });

    expect(result).toEqual({
      projects: [{ name: 'demo-project', lastUsed: 10 }],
      currentProject: 'demo-project'
    });
    expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({
      force: false,
      config: { currentProject: 'demo-project' }
    }));
  });

  it('builds a project payload through an injected platform driver', async () => {
    const getProjects = vi.fn(async () => [{ name: 'demo-project', lastUsed: 10 }]);
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { getProjects };
      })
    };

    const result = await worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config: { currentProject: 'demo-project' },
      options: { force: false },
      runtime
    });

    expect(result).toEqual({
      projects: [{ name: 'demo-project', lastUsed: 10 }],
      currentProject: 'demo-project'
    });
    expect(getProjects).toHaveBeenCalledWith(expect.objectContaining({
      force: false,
      config: { currentProject: 'demo-project' }
    }));
  });

  it('uses canonical runtime capabilities while accepting legacy and generic getters', async () => {
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        if (platform === 'codex') {
          expect(capability).toBe('projects');
          return { getProjectAndSessionCounts: vi.fn(async () => ({ projectCount: 2, sessionCount: 3 })) };
        }
        if (platform === 'gemini') {
          expect(capability).toBe('statistics');
          return { today: vi.fn(() => ({ sessions: 4 })) };
        }
        throw new Error(`unexpected platform ${platform}`);
      })
    };

    await expect(worker.buildPayload({ kind: 'counts', source: 'codex', config: { from: 'config' }, options: {}, runtime }))
      .resolves.toEqual({ projectCount: 2, sessionCount: 3 });
    await expect(worker.buildPayload({ kind: 'todayStats', source: 'gemini', config: {}, options: {}, runtime }))
      .resolves.toEqual({ sessions: 4 });
  });

  it('keeps known channel shapes for claude arrays and non-claude wrappers', async () => {
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        if (capability !== 'channels') {
          throw new Error(`unexpected capability ${capability}`);
        }
        if (platform === 'claude') {
          return { list: vi.fn(() => [{ id: 'claude-channel' }]) };
        }
        if (platform === 'opencode') {
          return { list: vi.fn(() => [{ id: 'opencode-channel' }]) };
        }
        throw new Error(`unexpected platform ${platform}`);
      })
    };

    await expect(worker.buildPayload({ kind: 'channels', source: 'claude', config: {}, options: {}, runtime }))
      .resolves.toEqual([{ id: 'claude-channel' }]);
    await expect(worker.buildPayload({ kind: 'channels', source: 'opencode', config: {}, options: {}, runtime }))
      .resolves.toEqual({ channels: [{ id: 'opencode-channel' }] });
  });

  it('does not include injected runtime functions in production IPC options', () => {
    expect(worker._test.getSerializableWorkerOptions({
      force: true,
      runtime: { getDriver: vi.fn() }
    })).toEqual({ force: true });
  });
});
