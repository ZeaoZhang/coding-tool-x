describe('omp-auth-providers', () => {
  let service;

  beforeEach(() => {
    delete require.cache[require.resolve('../../../src/platforms/drivers/omp/auth-providers')];
    service = require('../../../src/platforms/drivers/omp/auth-providers');
    service.clearOmpAuthProviderCache();
  });

  afterEach(() => {
    service.clearOmpAuthProviderCache();
  });

  function buildRunner() {
    return vi.fn((_command, args) => {
      const key = args.join(' ');
      if (key === 'auth-broker list --json') {
        return {
          status: 0,
          stdout: JSON.stringify([
            { id: 'openai-codex', name: 'ChatGPT Plus/Pro (Codex Subscription)' },
            { id: 'anthropic', name: 'Anthropic (Claude Pro/Max)' },
            { id: 'deepseek', name: 'DeepSeek' }
          ]),
          stderr: ''
        };
      }
      if (key === 'token openai-codex --list') {
        return { status: 0, stdout: '1 user@example.com\n', stderr: '' };
      }
      if (key === 'token anthropic --list') {
        return {
          status: 1,
          stdout: '',
          stderr: 'No OAuth accounts found for provider "anthropic".'
        };
      }
      if (key === 'auth-broker status --json') {
        return { status: 0, stdout: JSON.stringify({ ok: true }), stderr: '' };
      }
      if (key === 'auth-gateway status --json') {
        return { status: 1, stdout: JSON.stringify({ ready: false, reason: 'not_configured' }), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
  }

  test('lists login-capable providers with masked account identities', () => {
    const commandRunner = buildRunner();
    const snapshot = service.getOmpAuthProviderSnapshot({
      commandRunner,
      runtime: {
        runtime: 'omp',
        installed: true,
        command: 'omp'
      }
    });

    expect(snapshot.available).toBe(true);
    expect(snapshot.supportedProviders.map(provider => provider.id)).toEqual([
      'openai-codex',
      'anthropic',
      'deepseek'
    ]);
    expect(snapshot.providers).toEqual([
      expect.objectContaining({
        id: 'openai-codex',
        loggedIn: true,
        accountCount: 1,
        accounts: [{ index: 1, identity: 'us***r@example.com' }]
      }),
      expect.objectContaining({
        id: 'anthropic',
        loggedIn: false,
        accountCount: 0,
        accounts: []
      })
    ]);
    expect(snapshot.gatewayStatus).toEqual({ ready: false, reason: 'not_configured' });
    expect(commandRunner).not.toHaveBeenCalledWith(
      'omp',
      ['token', 'deepseek', '--list'],
      expect.anything()
    );
  });

  test('keeps multiple masked accounts for one provider independently selectable', () => {
    const commandRunner = buildRunner();
    commandRunner.mockImplementation((_command, args) => {
      const key = args.join(' ');
      if (key === 'auth-broker list --json') {
        return {
          status: 0,
          stdout: JSON.stringify([{ id: 'openai-codex', name: 'ChatGPT Plus/Pro' }]),
          stderr: ''
        };
      }
      if (key === 'token openai-codex --list') {
        return { status: 0, stdout: '1 first@example.com\n2 second@example.com\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const snapshot = service.getOmpAuthProviderSnapshot({
      commandRunner,
      runtime: { runtime: 'omp', installed: true, command: 'omp' },
      includeStatus: false
    });

    expect(snapshot.providers[0]).toEqual(expect.objectContaining({
      id: 'openai-codex',
      accountCount: 2,
      accounts: [
        { index: 1, identity: 'fi***t@example.com' },
        { index: 2, identity: 'se***d@example.com' }
      ]
    }));
  });

  test('resolves common provider aliases without exposing raw secrets', () => {
    const snapshot = {
      providers: [
        { id: 'openai-codex', loggedIn: true },
        { id: 'anthropic', loggedIn: false }
      ]
    };

    expect(service.findAuthProviderForKey('codex', snapshot).id).toBe('openai-codex');
    expect(service.findAuthProviderForKey('claude', snapshot).id).toBe('anthropic');
    expect(service.sanitizeIdentity('sk-1234567890abcdef user@example.com')).toBe('sk-*** us***r@example.com');
  });

  test('returns unavailable snapshot when OMP runtime is missing', () => {
    const snapshot = service.getOmpAuthProviderSnapshot({
      runtime: {
        runtime: 'omp',
        installed: false,
        command: 'omp'
      }
    });

    expect(snapshot.available).toBe(false);
    expect(snapshot.reason).toBe('omp-not-available');
    expect(snapshot.providers).toEqual([]);
  });

  test('reports cache metadata while auth-provider warmup is pending', () => {
    vi.useFakeTimers();
    try {
      const options = {
        runtime: {
          runtime: 'omp',
          installed: false,
          command: 'omp'
        }
      };

      service.warmOmpAuthProviderSnapshot(options);
      expect(service.getOmpAuthProviderCacheMeta(options)).toEqual(expect.objectContaining({
        cached: false,
        stale: true,
        refreshing: true,
        fallback: true
      }));

      vi.runOnlyPendingTimers();
      expect(service.getOmpAuthProviderCacheMeta(options)).toEqual(expect.objectContaining({
        cached: true,
        stale: false,
        refreshing: false,
        fallback: false,
        error: 'omp-not-available'
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
