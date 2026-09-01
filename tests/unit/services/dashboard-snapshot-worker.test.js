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

  it('preserves an injected runtime when the worker runs directly in NODE_ENV=test', async () => {
    const getProjects = vi.fn(async () => [{ name: 'test-runtime-project', lastUsed: 1 }]);
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { getProjects };
      })
    };
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    vi.spyOn(runtimeModule, 'getPlatformRuntime').mockImplementation(() => {
      throw new Error('default runtime should not be used for direct worker execution');
    });

    try {
      await expect(worker.runDashboardSnapshotWorker('projects', 'claude', {}, { runtime }))
        .resolves.toEqual({
          projects: [{ name: 'test-runtime-project', lastUsed: 1 }],
          currentProject: 'test-runtime-project'
        });
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }

    expect(getProjects).toHaveBeenCalledWith(expect.objectContaining({ force: false, config: {} }));
  });
  it('rejects typed failed payloads when run directly under NODE_ENV=test', async () => {
    const failedPayload = {
      status: 'failed',
      platform: 'demo-cli',
      capability: 'projects',
      operation: 'resolve-driver',
      error: 'broken snapshot driver',
      code: 'E_PROJECTS_FAILED'
    };
    const runtime = {
      getDriver: vi.fn(() => ({
        getProjects: vi.fn(async () => failedPayload)
      }))
    };
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    try {
      const error = await worker.runDashboardSnapshotWorker('projects', 'demo-cli', {}, { runtime })
        .then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe('failed');
      expect(error.code).toBe('E_PROJECTS_FAILED');
      expect(error.platform).toBe('demo-cli');
      expect(error.capability).toBe('projects');
      expect(error.operation).toBe('resolve-driver');
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause.message).toContain('broken snapshot driver');
      expect(error.failure).toBe(failedPayload);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  it('ignores injected runtimes outside NODE_ENV=test and still uses the platform runtime', async () => {
    const listProjects = vi.fn(async () => [{ name: 'production-project', lastUsed: 11 }]);
    const injectedRuntime = {
      getDriver: vi.fn(() => {
        throw new Error('injected runtime should be ignored outside test mode');
      })
    };
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.spyOn(runtimeModule, 'getPlatformRuntime').mockReturnValue({
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { listProjects };
      })
    });

    try {
      const result = await worker.buildPayload({
        kind: 'projects',
        source: 'claude',
        config: { currentProject: 'production-project' },
        options: { force: false, runtime: injectedRuntime },
        runtime: injectedRuntime
      });

      expect(result).toEqual({
        projects: [{ name: 'production-project', lastUsed: 11 }],
        currentProject: 'production-project'
      });
      expect(injectedRuntime.getDriver).not.toHaveBeenCalled();
      expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({
        force: false,
        config: { currentProject: 'production-project' }
      }));
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
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

  it('preserves Claude typed channel failures so dashboard worker rejects them', async () => {
    const failedPayload = {
      status: 'failed',
      platform: 'claude',
      capability: 'channels',
      operation: 'list',
      error: 'broken'
    };
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('channels');
        return { list: vi.fn(async () => failedPayload) };
      })
    };

    await expect(worker.buildPayload({
      kind: 'channels',
      source: 'claude',
      config: {},
      options: { force: false },
      runtime
    })).resolves.toBe(failedPayload);

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const error = await worker.runDashboardSnapshotWorker('channels', 'claude', {}, { runtime })
        .then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.platform).toBe('claude');
      expect(error.capability).toBe('channels');
      expect(error.operation).toBe('list');
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause.message).toBe('broken');
      expect(error.failure).toBe(failedPayload);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });


  it('returns unsupported counts with the counts capability for custom sources without counts or project getters', async () => {
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('demo-cli');
        expect(['counts', 'projects']).toContain(capability);
        return {};
      })
    };

    await expect(worker.buildPayload({ kind: 'counts', source: 'demo-cli', config: {}, options: { force: false }, runtime }))
      .resolves.toEqual({ status: 'unsupported', platform: 'demo-cli', capability: 'counts' });
  });
  it('returns typed failures when runtime driver resolution throws for custom dashboard snapshots', async () => {
    const cases = [
      ['projects', 'projects'],
      ['counts', 'counts'],
      ['todayStats', 'statistics'],
      ['channels', 'channels']
    ];

    for (const [kind, capability] of cases) {
      const resolutionError = new Error(`${capability} resolution exploded`);
      resolutionError.retryable = false;
      resolutionError.retryAfter = '2026-09-01T12:34:56.000Z';
      resolutionError.code = 'E_RESOLVE';
      const runtime = {
        getDriver: vi.fn((platform, requestedCapability) => {
          expect(platform).toBe('demo-cli');
          expect(requestedCapability).toBe(capability);
          throw resolutionError;
        })
      };

      const result = await worker.buildPayload({
        kind,
        source: 'demo-cli',
        config: {},
        options: { force: false },
        runtime
      });

      expect(result).toMatchObject({
        status: 'failed',
        platform: 'demo-cli',
        retryable: false,
        retryAfter: '2026-09-01T12:34:56.000Z',
        code: 'E_RESOLVE',
        capability,
        operation: 'resolve-driver',
        error: `${capability} resolution exploded`
      });
      expect(Object.prototype.propertyIsEnumerable.call(result, 'cause')).toBe(false);
      expect(result.cause).toBe(resolutionError);
      expect(runtime.getDriver).toHaveBeenCalledTimes(1);
    }
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
  it('preserves the projects failure returned by the primary getter instead of masking it with project-order errors', async () => {
    const failedPayload = {
      status: 'failed',
      platform: 'claude',
      capability: 'projects',
      operation: 'list',
      error: 'primary projects failed'
    };
    const getProjects = vi.fn(async () => failedPayload);
    const getProjectOrder = vi.fn(() => {
      throw new Error('secondary order failed');
    });
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('claude');
        expect(capability).toBe('projects');
        return { getProjects, getProjectOrder };
      })
    };

    await expect(worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config: {},
      options: { force: false },
      runtime
    })).resolves.toBe(failedPayload);
    expect(getProjectOrder).not.toHaveBeenCalled();
  });

  it('wraps Claude project getter failures and preserves typed cause fields', async () => {
    const cause = new Error('project getter exploded');
    cause.name = 'AdapterFailure';
    cause.code = 'E_PROJECTS';
    cause.status = 'failed';
    const getProjects = vi.fn(async () => {
      throw cause;
    });
    const runtime = {
      getDriver: vi.fn(() => ({ getProjects }))
    };

    const error = await worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config: {},
      options: { force: true },
      runtime
    }).then(() => null, (err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('project getter exploded');
    expect(error.message).toBe(cause.message);
    expect(error.status).toBe('failed');
    expect(error.platform).toBe('claude');
    expect(error.capability).toBe('projects');
    expect(error.operation).toBe('list');
    expect(error.cause).toBe(cause);
    expect(error.cause.code).toBe('E_PROJECTS');
  });

  it('propagates typed Claude project order failures with context instead of normalizing them', async () => {
    const cause = new Error('order getter exploded');
    cause.code = 'E_ORDER';
    const getProjects = vi.fn(async () => [
      { name: 'alpha-project', lastUsed: 1 }
    ]);
    const getProjectOrder = vi.fn(async () => {
      throw cause;
    });
    const runtime = {
      getDriver: vi.fn(() => ({ getProjects, getProjectOrder }))
    };

    const error = await worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config: {},
      options: { force: true },
      runtime
    }).then(() => null, (err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('order getter exploded');
    expect(error.message).toBe(cause.message);
    expect(error.platform).toBe('claude');
    expect(error.capability).toBe('project-order');
    expect(error.operation).toBe('get');
    expect(error.cause).toBe(cause);
    expect(error.cause.code).toBe('E_ORDER');
  });

  it('falls back to config project order when Claude project order getter returns a non-array value', async () => {
    const getProjects = vi.fn(async () => [
      { name: 'zeta-project', lastUsed: 30 },
      { name: 'alpha-project', lastUsed: 20 },
      { name: 'beta-project', lastUsed: 10 }
    ]);
    const getProjectOrder = vi.fn(async () => ({ stale: true }));
    const runtime = {
      getDriver: vi.fn(() => ({ getProjects, getProjectOrder }))
    };

    const result = await worker.buildPayload({
      kind: 'projects',
      source: 'claude',
      config: { projectOrder: ['alpha-project', 'beta-project'] },
      options: { force: false },
      runtime
    });

    expect(result.projects.map((project) => project.name)).toEqual([
      'alpha-project',
      'beta-project',
      'zeta-project'
    ]);
    expect(result.currentProject).toBe('alpha-project');
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

  it('preserves typed todayStats and channels payloads for custom sources instead of reaching the legacy fallback switch', async () => {
    const todayStatsPayload = { status: 'failed', error: 'today-stats-failed' };
    const channelsPayload = { status: 'unsupported', platform: 'demo-cli', capability: 'channels' };
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        if (platform === 'demo-cli' && capability === 'statistics') {
          return todayStatsPayload;
        }
        if (platform === 'demo-cli' && capability === 'channels') {
          return channelsPayload;
        }
        throw new Error(`unexpected platform ${platform} capability ${capability}`);
      })
    };

    await expect(worker.buildPayload({ kind: 'todayStats', source: 'demo-cli', config: {}, options: {}, runtime }))
      .resolves.toBe(todayStatsPayload);
    await expect(worker.buildPayload({ kind: 'channels', source: 'demo-cli', config: {}, options: {}, runtime }))
      .resolves.toBe(channelsPayload);
  });

  it('returns typed unsupported payloads for custom todayStats and channels sources without usable getters', async () => {
    const runtime = {
      getDriver: vi.fn((platform, capability) => {
        expect(platform).toBe('demo-cli');
        expect(['statistics', 'channels']).toContain(capability);
        return {};
      })
    };

    await expect(worker.buildPayload({ kind: 'todayStats', source: 'demo-cli', config: {}, options: { force: false }, runtime }))
      .resolves.toEqual({ status: 'unsupported', platform: 'demo-cli', capability: 'statistics' });
    await expect(worker.buildPayload({ kind: 'channels', source: 'demo-cli', config: {}, options: { force: false }, runtime }))
      .resolves.toEqual({ status: 'unsupported', platform: 'demo-cli', capability: 'channels' });
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

  it('does not apply global config currentProject to non-Claude project payloads', async () => {
    for (const source of ['codex', 'gemini', 'opencode', 'omp']) {
      const getProjects = vi.fn(async () => [
        { name: `${source}-first`, lastUsed: 30 },
        { name: `${source}-second`, lastUsed: 20 }
      ]);
      const runtime = {
        getDriver: vi.fn((platform, capability) => {
          expect(platform).toBe(source);
          expect(capability).toBe('projects');
          return { getProjects };
        })
      };

      await expect(worker.buildPayload({
        kind: 'projects',
        source,
        config: { currentProject: 'global-claude-project' },
        options: { force: false },
        runtime
      })).resolves.toEqual({
        projects: [
          { name: `${source}-first`, lastUsed: 30 },
          { name: `${source}-second`, lastUsed: 20 }
        ],
        currentProject: `${source}-first`
      });
    }
  });

  it('preserves non-Claude payload currentProject when supplied', async () => {
    const runtime = {
      getDriver: vi.fn(() => ({
        getProjects: vi.fn(async () => ({
          projects: [{ name: 'codex-first', lastUsed: 1 }],
          currentProject: 'codex-payload-project'
        }))
      }))
    };

    await expect(worker.buildPayload({
      kind: 'projects',
      source: 'codex',
      config: { currentProject: 'global-claude-project' },
      options: { force: false },
      runtime
    })).resolves.toEqual({
      projects: [{ name: 'codex-first', lastUsed: 1 }],
      currentProject: 'codex-payload-project'
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

  it('builds source payloads concurrently and serializes allowlisted failure metadata', async () => {
    const channelsError = new Error('channels unavailable');
    channelsError.retryable = false;
    channelsError.retryAfter = '2026-09-01T12:34:56.000Z';
    channelsError.code = 'E_CHANNELS';
    channelsError.cause = {
      name: 'AdapterError',
      message: 'adapter exploded',
      code: 'E_ADAPTER',
      retryable: true,
      retryAfter: 1700000000000,
      unsafe: { bigint: 1n }
    };

    const getDriver = vi.fn((source, capability) => {
      expect(source).toBe('demo-cli');
      if (capability === 'channels') return { list: vi.fn(async () => { throw channelsError; }) };
      if (capability === 'statistics') return { getTodayStatistics: vi.fn(async () => ({ summary: { requests: 4, tokens: 8, cost: 0.2 } })) };
      if (capability === 'counts') return { getProjectAndSessionCounts: vi.fn(async () => ({ projectCount: 2, sessionCount: 3 })) };
      throw new Error(`unexpected capability ${capability}`);
    });

    const payload = await worker.buildSourceDashboardPayload('demo-cli', { cwd: '/tmp/demo' }, { force: true, runtime: { getDriver } });
    const failure = payload.__errors[0];

    expect(payload.channels).toEqual({ channels: [] });
    expect(payload.__errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'failed',
        platform: 'demo-cli',
        capability: 'channels',
        operation: 'list',
        error: 'channels unavailable',
        retryable: false,
        retryAfter: '2026-09-01T12:34:56.000Z',
        code: 'E_CHANNELS',
        cause: {
          name: 'AdapterError',
          message: 'adapter exploded',
          retryable: true,
          retryAfter: 1700000000000,
          code: 'E_ADAPTER'
        }
      })
    ]));
    expect(failure).not.toHaveProperty('unsafe');
    expect(failure.cause).not.toHaveProperty('unsafe');
    expect(failure.cause).not.toHaveProperty('bigint');
    expect(failure.cause.retryable).toBe(true);
    expect(failure.cause.retryAfter).toBe(1700000000000);
    expect(() => JSON.stringify(payload.__errors)).not.toThrow();
    expect(payload.todayStats).toEqual({ summary: { requests: 4, tokens: 8, cost: 0.2 } });
    expect(payload.counts).toEqual({ projectCount: 2, sessionCount: 3 });
    expect(getDriver).toHaveBeenCalledTimes(3);
  });
  it('defaults unannotated source capability failures to retryable', async () => {
    const getDriver = vi.fn((source, capability) => {
      expect(source).toBe('demo-cli');
      if (capability === 'channels') {
        return { list: vi.fn(async () => { throw new Error('transient channels failure'); }) };
      }
      if (capability === 'statistics') {
        return { today: vi.fn(async () => null) };
      }
      if (capability === 'counts') {
        return { counts: vi.fn(async () => ({ projectCount: 1, sessionCount: 2 })) };
      }
      throw new Error(`unexpected capability ${capability}`);
    });

    const payload = await worker.buildSourceDashboardPayload(
      'demo-cli',
      {},
      { runtime: { getDriver } }
    );

    expect(payload.__errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'channels',
        error: 'transient channels failure',
        retryable: true
      })
    ]));
  });



  it('records statistics capability failures while preserving sibling source values', async () => {
    const runtime = { getDriver: vi.fn((source, capability) => {
      if (capability === 'channels') return { list: vi.fn(async () => [{ id: 'ok' }]) };
      if (capability === 'statistics') return { today: vi.fn(async () => { throw new Error('stats unavailable'); }) };
      if (capability === 'counts') return { counts: vi.fn(async () => ({ projectCount: 1, sessionCount: 2 })) };
      throw new Error(`unexpected capability ${capability}`);
    }) };
    const payload = await worker.buildSourceDashboardPayload('demo-cli', {}, { runtime });
    expect(payload.channels).toEqual({ channels: [{ id: 'ok' }] });
    expect(payload.todayStats).toBeNull();
    expect(payload.counts).toEqual({ projectCount: 1, sessionCount: 2 });
    expect(payload.__errors).toEqual(expect.arrayContaining([expect.objectContaining({ capability: 'statistics', error: 'stats unavailable' })]));
  });

  it('dispatches source messages through the same build payload IPC branch', async () => {
    const runtime = {
      getDriver: vi.fn((source, capability) => {
        expect(source).toBe('demo-cli');
        if (capability === 'channels') return { list: vi.fn(async () => []) };
        if (capability === 'statistics') return { today: vi.fn(async () => null) };
        if (capability === 'counts') return { counts: vi.fn(async () => ({ projectCount: 1, sessionCount: 1 })) };
        throw new Error(`unexpected capability ${capability}`);
      })
    };

    await expect(worker.buildPayload({
      kind: 'source',
      source: 'demo-cli',
      config: {},
      options: { force: false },
      runtime
    })).resolves.toEqual({
      channels: { channels: [] },
      todayStats: null,
      counts: { projectCount: 1, sessionCount: 1 }
    });
  });

  it('rejects typed failed payloads from child IPC instead of resolving snapshot values', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const cp = require('child_process');
    const handlers = {};
    const child = {
      killed: false,
      stderr: { on: vi.fn() },
      removeAllListeners: vi.fn(),
      kill: vi.fn(() => {
        child.killed = true;
      }),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
        return child;
      }),
      send: vi.fn()
    };
    const forkSpy = vi.spyOn(cp, 'fork').mockReturnValue(child);
    const failedPayload = {
      status: 'failed',
      platform: 'demo-cli',
      capability: 'projects',
      operation: 'resolve-driver',
      error: 'child exploded',
      code: 'E_CHILD_FAILED'
    };
    process.env.NODE_ENV = 'production';

    try {
      const promise = worker.runDashboardSnapshotWorker('projects', 'demo-cli', {}, { force: true });
      handlers.message({ ok: true, value: failedPayload });
      const error = await promise.then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe('failed');
      expect(error.code).toBe('E_CHILD_FAILED');
      expect(error.platform).toBe('demo-cli');
      expect(error.capability).toBe('projects');
      expect(error.operation).toBe('resolve-driver');
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause.message).toContain('child exploded');
      expect(child.kill).toHaveBeenCalled();
      expect(child.removeAllListeners).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      forkSpy.mockRestore();
    }
  });

  it('reconstructs structured worker errors from child IPC', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const cp = require('child_process');
    const handlers = {};
    const child = {
      killed: false,
      stderr: { on: vi.fn() },
      removeAllListeners: vi.fn(),
      kill: vi.fn(() => {
        child.killed = true;
      }),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
        return child;
      }),
      send: vi.fn()
    };
    const forkSpy = vi.spyOn(cp, 'fork').mockReturnValue(child);
    process.env.NODE_ENV = 'production';

    try {
      const promise = worker.runDashboardSnapshotWorker('projects', 'demo-cli', {}, { force: true });
      handlers.message({
        ok: false,
        error: {
          status: 'failed',
          message: 'Dashboard snapshot projects list failed on demo-cli: adapter exploded',
          platform: 'demo-cli',
          capability: 'projects',
          operation: 'list',
          retryable: false,
          retryAfter: '2026-09-01T12:34:56.000Z',
          code: 'E_INVENTORY',
          cause: {
            name: 'AdapterError',
            message: 'adapter exploded',
            retryable: true,
            retryAfter: 1700000000000,
            code: 'E_ADAPTER'
          }
        }
      });
      const error = await promise.then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe('failed');
      expect(error.code).toBe('E_INVENTORY');
      expect(error.retryable).toBe(false);
      expect(error.retryAfter).toBe('2026-09-01T12:34:56.000Z');
      expect(error.message).toContain('adapter exploded');
      expect(error.platform).toBe('demo-cli');
      expect(error.capability).toBe('projects');
      expect(error.operation).toBe('list');
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause.name).toBe('AdapterError');
      expect(error.cause.message).toBe('adapter exploded');
      expect(error.cause.code).toBe('E_ADAPTER');
      expect(error.cause.retryable).toBe(true);
      expect(error.cause.retryAfter).toBe(1700000000000);
      expect(child.kill).toHaveBeenCalled();
      expect(child.removeAllListeners).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      forkSpy.mockRestore();
    }
  });
  it('serializes and deserializes retry metadata using a JSON-safe allowlist', () => {
    const cause = new Error('adapter exploded');
    cause.name = 'AdapterError';
    cause.retryable = true;
    cause.retryAfter = 1700000000000;
    cause.code = 9001;
    const error = new Error('snapshot failed');
    error.platform = 'demo-cli';
    error.capability = 'projects';
    error.operation = 'list';
    error.retryable = false;
    error.retryAfter = '2026-09-01T12:34:56.000Z';
    error.code = { unsafe: true };
    error.cause = cause;

    const serialized = worker._test.serializeError(error);
    const roundTrip = worker._test.deserializeError(serialized, 'fallback snapshot error');

    expect(serialized).toEqual({
      message: 'snapshot failed',
      platform: 'demo-cli',
      capability: 'projects',
      operation: 'list',
      retryable: false,
      retryAfter: '2026-09-01T12:34:56.000Z',
      cause: {
        name: 'AdapterError',
        message: 'adapter exploded',
        retryable: true,
        retryAfter: 1700000000000,
        code: 9001
      }
    });
    expect(roundTrip.retryable).toBe(false);
    expect(roundTrip.retryAfter).toBe('2026-09-01T12:34:56.000Z');
    expect(roundTrip.cause.retryable).toBe(true);
    expect(roundTrip.cause.retryAfter).toBe(1700000000000);
    expect(roundTrip.cause.code).toBe(9001);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it('round-trips nested causes within the serialized depth bound', () => {
    const storageError = new Error('disk full');
    storageError.name = 'StorageError';
    storageError.retryable = false;
    storageError.retryAfter = 1700000000000;
    storageError.code = 'E_STORAGE';
    const adapterError = new Error('adapter exploded');
    adapterError.name = 'AdapterError';
    adapterError.retryable = true;
    adapterError.code = 'E_ADAPTER';
    adapterError.cause = storageError;
    const error = new Error('snapshot failed');
    error.cause = adapterError;

    const serialized = worker._test.serializeError(error);
    const roundTrip = worker._test.deserializeError(serialized, 'fallback snapshot error');

    expect(serialized.cause.cause).toEqual({
      name: 'StorageError',
      message: 'disk full',
      retryable: false,
      retryAfter: 1700000000000,
      code: 'E_STORAGE'
    });
    expect(roundTrip.cause).toBeInstanceOf(Error);
    expect(roundTrip.cause.name).toBe('AdapterError');
    expect(roundTrip.cause.retryable).toBe(true);
    expect(roundTrip.cause.code).toBe('E_ADAPTER');
    expect(roundTrip.cause.cause).toBeInstanceOf(Error);
    expect(roundTrip.cause.cause.name).toBe('StorageError');
    expect(roundTrip.cause.cause.message).toBe('disk full');
    expect(roundTrip.cause.cause.retryable).toBe(false);
    expect(roundTrip.cause.cause.retryAfter).toBe(1700000000000);
    expect(roundTrip.cause.cause.code).toBe('E_STORAGE');
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it('omits unsafe cause code values that would break JSON IPC serialization', () => {
    const cause = new Error('adapter exploded');
    cause.code = 1n;
    const error = new Error('snapshot failed');
    error.platform = 'demo-cli';
    error.capability = 'projects';
    error.operation = 'list';
    error.code = () => 'E_UNSAFE';
    error.cause = cause;

    const serialized = worker._test.serializeError(error);

    expect(serialized).not.toHaveProperty('code');
    expect(serialized.cause).not.toHaveProperty('code');
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it('serializes typed worker failure values without unsafe code properties', () => {
    const serialized = worker._test.serializeWorkerValue({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'projects',
      operation: 'list',
      error: 'adapter exploded',
      retryable: false,
      retryAfter: 1700000000000,
      code: 1n,
      cause: {
        name: 'AdapterError',
        message: 'adapter exploded',
        retryable: true,
        retryAfter: '2026-09-01T12:34:56.000Z',
        code: { unsafe: true }
      }
    });

    expect(serialized).toEqual({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'projects',
      operation: 'list',
      error: 'adapter exploded',
      retryable: false,
      retryAfter: 1700000000000,
      cause: {
        name: 'AdapterError',
        message: 'adapter exploded',
        retryable: true,
        retryAfter: '2026-09-01T12:34:56.000Z'
      }
    });
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });


  it('rejects serialization errors from child.send and cleans up the worker', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const cp = require('child_process');
    const child = {
      killed: false,
      stderr: { on: vi.fn() },
      removeAllListeners: vi.fn(),
      kill: vi.fn(() => {
        child.killed = true;
      }),
      on: vi.fn((event, handler) => {
        if (event === 'message') {
          child.messageHandler = handler;
        }
        return child;
      }),
      send: vi.fn(() => {
        throw new Error('could not serialize');
      })
    };
    const forkSpy = vi.spyOn(cp, 'fork').mockReturnValue(child);
    process.env.NODE_ENV = 'production';

    try {
      const error = await worker.runDashboardSnapshotWorker('projects', 'demo-cli', {}, { force: true })
        .then(() => null, (err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('could not serialize');
      expect(child.kill).toHaveBeenCalled();
      expect(child.removeAllListeners).toHaveBeenCalled();
      expect(child.send).toHaveBeenCalledWith({ kind: 'projects', source: 'demo-cli', config: {}, options: { force: true } });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      forkSpy.mockRestore();
    }
  });
  it('exits nonzero when worker IPC send throws synchronously', () => {
    const exit = vi.fn();
    const send = vi.fn(() => {
      throw new Error('send exploded');
    });

    worker._test.sendWorkerMessage({ ok: true }, 0, send, exit);

    expect(send).toHaveBeenCalledWith({ ok: true }, expect.any(Function));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits with a nonzero requested code when the worker IPC send callback reports an error', () => {
    const exit = vi.fn();
    const send = vi.fn((_payload, callback) => {
      callback(new Error('callback exploded'));
    });

    worker._test.sendWorkerMessage({ ok: false }, 3, send, exit);

    expect(send).toHaveBeenCalledWith({ ok: false }, expect.any(Function));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(3);
  });
  it('does not include injected runtime functions in production IPC options', () => {
    expect(worker._test.getSerializableWorkerOptions({
      force: true,
      runtime: { getDriver: vi.fn() },
      config: { nested: true },
      extra: 'ignore-me'
    })).toEqual({ force: true });
  });


});
