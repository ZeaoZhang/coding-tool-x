const {
  prepareManagedOmpChannels
} = require('../../../src/server/services/omp-gateway-routing');

const PROVIDER_APIS = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-gemini-cli',
  'google-vertex'
];

function gateway(secret = 'routing-secret') {
  return {
    host: '127.0.0.1',
    port: 20092,
    secret
  };
}

describe('OMP gateway routing', () => {
  it.each(PROVIDER_APIS)('preserves the %s provider contract behind a local capability', (providerApi) => {
    const [managed] = prepareManagedOmpChannels([{
      id: `channel-${providerApi}`,
      providerKey: `provider-${providerApi}`,
      providerApi,
      baseUrl: 'https://upstream.example/native/path?api-version=2026-01-01',
      apiKey: 'upstream-secret',
      headers: { authorization: 'never-persist-this' },
      enabled: true,
      model: 'test-model'
    }], gateway()).managedChannels;

    expect(managed.providerApi).toBe(providerApi);
    expect(managed.baseUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:20092\/omp\/[a-f0-9]{24}$/
    );
    expect(managed.apiKey).toMatch(/^ctx_[a-f0-9]{40}$/);
    expect(managed.apiKey).not.toBe('upstream-secret');
    expect(managed.headers).toBeUndefined();
  });

  it('keeps custom-group managed provider IDs stable across gateway restarts', () => {
    const channels = [
      {
        id: 'channel-primary',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'primary',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret',
        enabled: true,
        model: 'gpt-5'
      },
      {
        id: 'channel-backup',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'backup',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret',
        enabled: true,
        model: 'gpt-5'
      }
    ];

    const first = prepareManagedOmpChannels(channels, gateway('first-secret'))
      .managedChannels.map(channel => channel.managedProviderId);
    const second = prepareManagedOmpChannels(channels, gateway('second-secret'))
      .managedChannels.map(channel => channel.managedProviderId);

    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
  });

  it('never copies credential query parameters from an upstream base URL', () => {
    const [managed] = prepareManagedOmpChannels([{
      id: 'google-query-key',
      providerKey: 'google',
      providerApi: 'google-generative-ai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta?key=upstream-secret&api-version=v1',
      apiKey: 'upstream-secret',
      enabled: true
    }], gateway()).managedChannels;

    expect(managed.baseUrl).not.toContain('upstream-secret');
    expect(new URL(managed.baseUrl).search).toBe('');
    expect(managed.baseUrl).not.toContain('/v1beta');
  });

  it('isolates legacy channels without routingGroup and rejects inconsistent redirects in an explicit group', () => {
    const isolated = prepareManagedOmpChannels([
      {
        id: 'legacy-a',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret',
        enabled: true
      },
      {
        id: 'legacy-b',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret',
        enabled: true
      }
    ], gateway());
    expect(isolated.routes).toHaveLength(2);
    expect(isolated.routes.map(route => route.channelIds)).toEqual([['legacy-a'], ['legacy-b']]);

    expect(() => prepareManagedOmpChannels([
      {
        id: 'group-a',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'shared',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret',
        modelRedirects: [{ from: 'gpt', to: 'gpt-5' }],
        enabled: true
      },
      {
        id: 'group-b',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'shared',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret',
        modelRedirects: [{ from: 'gpt', to: 'gpt-4.1' }],
        enabled: true
      }
    ], gateway())).toThrow('inconsistent modelRedirects');
  });

  it('rejects channels that expose different capability metadata for the same grouped model', () => {
    expect(() => prepareManagedOmpChannels([
      {
        id: 'capability-a',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'shared',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret',
        models: [{ id: 'gpt-5', supportsTools: true }],
        enabled: true
      },
      {
        id: 'capability-b',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'shared',
        baseUrl: 'https://api.example/v1',
        apiKey: 'secret',
        models: [{ id: 'gpt-5', supportsTools: false }],
        enabled: true
      }
    ], gateway())).toThrow('incompatible capability metadata for model "gpt-5"');
  });

  it('groups compatible channels even when their upstream base paths differ', () => {
    const prepared = prepareManagedOmpChannels([
      {
        id: 'vendor-a',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'shared',
        baseUrl: 'https://vendor-a.example/v1?api-version=2026-01-01',
        apiKey: 'secret-a',
        models: [{ id: 'gpt-5', supportsTools: true }],
        enabled: true
      },
      {
        id: 'vendor-b',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'shared',
        baseUrl: 'https://vendor-b.example/openai/v1',
        apiKey: 'secret-b',
        models: [{ id: 'gpt-5', supportsTools: true }],
        enabled: true
      }
    ], gateway());

    expect(prepared.routes).toEqual([
      expect.objectContaining({
        routingGroup: 'shared',
        channelIds: ['vendor-a', 'vendor-b']
      })
    ]);
    expect(prepared.managedChannels).toHaveLength(1);
  });

  it('exposes the union of compatible models from every channel in a routing group', () => {
    const prepared = prepareManagedOmpChannels([
      {
        id: 'model-a',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'shared',
        baseUrl: 'https://vendor-a.example/v1',
        apiKey: 'secret-a',
        models: [{ id: 'gpt-4.1', supportsTools: true }],
        enabled: true
      },
      {
        id: 'model-b',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        routingGroup: 'shared',
        baseUrl: 'https://vendor-b.example/v1',
        apiKey: 'secret-b',
        models: [{ id: 'gpt-5', supportsTools: true }],
        allowedModels: ['gpt-5-mini'],
        enabled: true
      }
    ], gateway());

    expect(prepared.managedChannels[0].models).toEqual([
      expect.objectContaining({ id: 'gpt-4.1' }),
      expect.objectContaining({ id: 'gpt-5' })
    ]);
    expect(prepared.managedChannels[0].allowedModels).toEqual(['gpt-5-mini']);
  });

  it('keeps OAuth native unless the channel explicitly targets a pi-native auth gateway', () => {
    const channels = [
      {
        id: 'oauth-native',
        name: 'Native OAuth',
        providerKey: 'anthropic',
        providerApi: 'anthropic-messages',
        authMode: 'oauth',
        baseUrl: 'https://api.anthropic.com',
        enabled: true
      },
      {
        id: 'oauth-gateway',
        name: 'Gateway OAuth',
        providerKey: 'google',
        providerApi: 'google-gemini-cli',
        authMode: 'oauth',
        baseUrl: 'http://127.0.0.1:7890',
        apiKey: 'local-auth-gateway-capability',
        providerConfig: { transport: 'pi-native' },
        enabled: true
      }
    ];

    const prepared = prepareManagedOmpChannels(channels, {
      ...gateway(),
      supportedOAuthChannelIds: ['oauth-gateway']
    });
    expect(prepared.unsupportedChannels).toEqual([expect.objectContaining({
      id: 'oauth-native',
      reason: 'oauth-auth-gateway-unavailable'
    })]);
    expect(prepared.routes).toEqual([expect.objectContaining({
      channelIds: ['oauth-gateway'],
      authMode: 'oauth'
    })]);
  });

  it('does not generate a route for an unknown provider API', () => {
    const prepared = prepareManagedOmpChannels([{
      id: 'unknown-api',
      name: 'Unknown API',
      providerKey: 'custom',
      providerApi: 'custom-unverified-wire-format',
      baseUrl: 'https://custom.example',
      apiKey: 'secret',
      enabled: true
    }], gateway());

    expect(prepared.routes).toEqual([]);
    expect(prepared.unsupportedChannels).toEqual([expect.objectContaining({
      id: 'unknown-api',
      reason: 'unsupported-provider-api'
    })]);
  });
});
