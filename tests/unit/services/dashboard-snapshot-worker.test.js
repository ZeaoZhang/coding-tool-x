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

  it('uses canonical default runtime capabilities for counts and channels', async () => {
    const getProjectAndSessionCounts = vi.fn(async () => ({ projectCount: 2, sessionCount: 3 }));
    const getChannels = vi.fn(async () => [{ id: 'open-channel' }]);
    const getDriver = vi.fn((platform, capability) => {
      if (platform === 'codex') {
        if (capability === 'counts') {
          return null;
        }
        expect(capability).toBe('projects');
        return { getProjectAndSessionCounts };
      }
      if (platform === 'opencode') {
        expect(capability).toBe('channels');
        return { getChannels };
      }
      throw new Error(`unexpected platform ${platform}`);
    });
    vi.spyOn(runtimeModule, 'getPlatformRuntime').mockReturnValue({ getDriver });

    await expect(worker.buildPayload({ kind: 'counts', source: 'codex', config: {}, options: { force: false } }))
      .resolves.toEqual({ projectCount: 2, sessionCount: 3 });
    await expect(worker.buildPayload({ kind: 'channels', source: 'opencode', config: {}, options: { force: false } }))
      .resolves.toEqual({ channels: [{ id: 'open-channel' }] });

    expect(getDriver).toHaveBeenCalledWith('codex', 'counts');
    expect(getDriver).toHaveBeenCalledWith('codex', 'projects');
    expect(getDriver).toHaveBeenCalledWith('opencode', 'channels');
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

  it('sorts default runtime Claude projects from persisted order and preserves configured current project', async () => {
    const getProjects = vi.fn(async () => [
      { name: 'zeta-project', lastUsed: 30 },
      { name: 'alpha-project', lastUsed: 20 },
      { name: 'beta-project', lastUsed: 10 }
    ]);
    const getProjectOrder = vi.fn(() => ['beta-project', 'zeta-project']);
    vi.spyOn(runtimeModule, 'getPlatformRuntime').mockReturnValue({
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { getProjects, getProjectOrder };
      })
    });

    const config = { currentProject: 'alpha-project' };
    const result = await worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config,
      options: { force: false }
    });

    expect(result).toEqual({
      projects: [
        { name: 'beta-project', lastUsed: 10 },
        { name: 'zeta-project', lastUsed: 30 },
        { name: 'alpha-project', lastUsed: 20 }
      ],
      currentProject: 'alpha-project'
    });
    expect(getProjects).toHaveBeenCalledWith(expect.objectContaining({
      force: false,
      config
    }));
    expect(getProjectOrder).toHaveBeenCalledWith(expect.objectContaining({
      force: false,
      config
    }));
  });

  it('uses canonical runtime capabilities while accepting legacy and generic getters', async () => {
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        if (platform === 'codex') {
          if (capability === 'counts') {
            return null;
          }
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

  it('accepts wrapped Claude project payloads and preserves an explicit payload current project', async () => {
    const getProjects = vi.fn(async () => ({
      projects: [
        { name: 'zeta-project', lastUsed: 30 },
        { name: 'alpha-project', lastUsed: 20 },
        { name: 'beta-project', lastUsed: 10 }
      ],
      currentProject: 'payload-project'
    }));
    const getProjectOrder = vi.fn(() => ['beta-project', 'zeta-project']);
    vi.spyOn(runtimeModule, 'getPlatformRuntime').mockReturnValue({
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { getProjects, getProjectOrder };
      })
    });

    const result = await worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config: { currentProject: 'config-project' },
      options: { force: false }
    });

    expect(result).toEqual({
      projects: [
        { name: 'beta-project', lastUsed: 10 },
        { name: 'zeta-project', lastUsed: 30 },
        { name: 'alpha-project', lastUsed: 20 }
      ],
      currentProject: 'payload-project'
    });
  });

  it('preserves config currentProject when a wrapped payload omits its own currentProject', async () => {
    const getProjects = vi.fn(async () => ({
      projects: [
        { name: 'zeta-project', lastUsed: 30 },
        { name: 'alpha-project', lastUsed: 20 },
        { name: 'beta-project', lastUsed: 10 }
      ]
    }));
    const getProjectOrder = vi.fn(() => ['beta-project', 'zeta-project']);
    vi.spyOn(runtimeModule, 'getPlatformRuntime').mockReturnValue({
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { getProjects, getProjectOrder };
      })
    });

    const result = await worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config: { currentProject: 'config-project' },
      options: { force: false }
    });

    expect(result).toEqual({
      projects: [
        { name: 'beta-project', lastUsed: 10 },
        { name: 'zeta-project', lastUsed: 30 },
        { name: 'alpha-project', lastUsed: 20 }
      ],
      currentProject: 'config-project'
    });
  });

  it('returns unsupported project wrappers unchanged instead of empty success payloads', async () => {
    const unsupported = { type: 'unsupported', projects: [], error: 'unsupported-driver' };
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { getProjects: vi.fn(async () => unsupported) };
      })
    };

    await expect(worker.buildPayload({ kind: 'projects', source: 'claude', config: {}, options: {}, runtime }))
      .resolves.toBe(unsupported);
  });

  it('returns unrecognized project payload values unchanged', async () => {
    const unsupported = { type: 'failed', error: 'boom' };
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { getProjects: vi.fn(async () => unsupported) };
      })
    };

    await expect(worker.buildPayload({ kind: 'projects', source: 'claude', config: {}, options: {}, runtime }))
      .resolves.toBe(unsupported);
  });
  it('returns a typed unsupported payload for custom project sources without a runtime getter', async () => {
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('demo-cli');
        expect(capability).toBe('projects');
        return {};
      })
    };

    await expect(worker.buildPayload({ kind: 'projects', source: 'demo-cli', config: {}, options: { force: false }, runtime }))
      .resolves.toEqual({ status: 'unsupported', platform: 'demo-cli', capability: 'projects' });
  });



  it('does not include injected runtime functions in production IPC options', () => {
    expect(worker._test.getSerializableWorkerOptions({
      force: true,
      runtime: { getDriver: vi.fn() }
    })).toEqual({ force: true });
  });
});
