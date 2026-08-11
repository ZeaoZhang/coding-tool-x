const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

let testDir;
let modelDetector;
let configState;
let cachePath;
let https;

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  if (typeof value !== 'object') return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function buildListSignature(channel, channelType) {
  const base = {
    id: channel.id || '',
    name: channel.name || '',
    baseUrl: channel.baseUrl || '',
    apiKey: channel.apiKey || '',
    gatewaySourceType: channel.gatewaySourceType || '',
    wireApi: channel.wireApi || '',
    model: channel.model || '',
    speedTestModel: channel.speedTestModel || '',
    presetId: channel.presetId || '',
    modelConfig: channel.modelConfig || null,
    modelRedirects: Array.isArray(channel.modelRedirects) ? channel.modelRedirects : []
  };

  const raw = stableStringify({
    channel: base,
    payload: {
      type: 'model-list',
      channelType: String(channelType || '').trim().toLowerCase()
    }
  });

  return crypto.createHash('sha1').update(raw).digest('hex');
}

function mockHttpsRequestSequence(sequence) {
  const calls = [];
  const spy = vi.spyOn(https, 'request').mockImplementation((options, callback) => {
    const call = { ...options, body: '' };
    calls.push(call);

    const req = new EventEmitter();
    const next = sequence.shift();

    req.write = vi.fn((chunk) => {
      call.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    });
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      if (!next) {
        throw new Error('No mocked https response left');
      }

      if (next.type === 'error') {
        process.nextTick(() => req.emit('error', new Error(next.message || 'network error')));
        return;
      }

      if (next.type === 'timeout') {
        process.nextTick(() => req.emit('timeout'));
        return;
      }

      const res = new EventEmitter();
      res.statusCode = next.statusCode;
      res.headers = next.headers || {};
      res.pipe = vi.fn(() => res);

      process.nextTick(() => {
        callback(res);
        if (Array.isArray(next.bodyChunks)) {
          next.bodyChunks.forEach((chunk) => res.emit('data', Buffer.from(chunk)));
        } else if (next.body !== undefined) {
          res.emit('data', Buffer.from(next.body));
        }
        res.emit('end');
      });
    });

    return req;
  });

  return { calls, spy };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-detector-'));
  cachePath = path.join(testDir, '.cc-tool', 'channel-models.json');
  https = require('https');
  configState = {
    defaultModels: {
      codex: ['gpt5', 'gpt-5-codex', 'gpt-4o'],
      claude: ['claude-sonnet-4']
    },
    modelDiscovery: {
      useV1ModelsEndpoint: true
    }
  };

  require.cache[require.resolve('../../../src/config/loader')] = {
    id: require.resolve('../../../src/config/loader'),
    filename: require.resolve('../../../src/config/loader'),
    loaded: true,
    exports: {
      loadConfig: vi.fn(() => configState)
    }
  };

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      PATHS: {
        channelModels: cachePath
      }
    }
  };

  delete require.cache[require.resolve('../../../src/server/services/model-detector')];
  modelDetector = require('../../../src/server/services/model-detector');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/model-detector',
    '../../../src/config/loader',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('model-detector helpers and cache management', () => {
  test('reads configured model priority and normalizes aliases for OpenAI-compatible channels', () => {
    expect(modelDetector.getModelPriority('openai_compatible')).toEqual([
      'gpt-5-codex',
      'gpt-4o'
    ]);
  });

  test('falls back to built-in model priority when configured defaults are empty', () => {
    configState.defaultModels = {};

    expect(modelDetector.getModelPriority('openai_compatible')).toEqual(expect.arrayContaining([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5-codex'
    ]));
  });

  test('detects official providers and falls back to openai-compatible for proxies', () => {
    expect(modelDetector.detectChannelType({ baseUrl: 'https://api.anthropic.com' })).toBe('claude');
    expect(modelDetector.detectChannelType({ baseUrl: 'https://code.newcli.com/claude/aws' })).toBe('openai_compatible');
    expect(modelDetector.detectChannelType({ baseUrl: 'not-a-url-but-api.openai.com' })).toBe('codex');
  });

  test('normalizes model names and clears cached entries from disk', () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      ch1: {
        availableModels: ['gpt-5'],
        fetchedModels: ['gpt-5', 'gpt-4o'],
        lastChecked: '2026-03-17T00:00:00.000Z'
      }
    }, null, 2), 'utf8');

    expect(modelDetector.normalizeModelName('gpt5')).toBe('gpt-5-codex');
    expect(modelDetector.getCachedModelInfo('ch1')).toEqual(expect.objectContaining({
      availableModels: ['gpt-5'],
      fetchedModels: ['gpt-5', 'gpt-4o']
    }));

    modelDetector.clearCache('ch1');

    expect(modelDetector.getCachedModelInfo('ch1')).toBeNull();
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf8'))).toEqual({});
  });

  test('returns disabled and unsupported results without making network requests', async () => {
    const channel = {
      id: 'c1',
      name: 'Demo',
      baseUrl: 'https://api.openai.com',
      apiKey: 'secret'
    };

    configState.modelDiscovery.useV1ModelsEndpoint = false;
    expect(await modelDetector.fetchModelsFromProvider(channel, 'codex')).toEqual(expect.objectContaining({
      models: [],
      supported: true,
      fallbackUsed: true,
      cached: false,
      disabledByConfig: true
    }));

    configState.modelDiscovery.useV1ModelsEndpoint = true;
    expect(await modelDetector.fetchModelsFromProvider(channel, 'claude')).toEqual({
      models: [],
      supported: false,
      fallbackUsed: true,
      cached: false,
      error: null
    });
  });

  test('reuses cached /v1/models results when the channel signature matches', async () => {
    const channel = {
      id: 'cached-channel',
      name: 'Cached Demo',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'cached-secret'
    };

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const lastChecked = new Date().toISOString();
    fs.writeFileSync(cachePath, JSON.stringify({
      'cached-channel': {
        fetchedModels: ['gpt-5', 'gpt-4o'],
        availableModels: ['gpt-5'],
        preferredTestModel: 'gpt-5',
        lastChecked,
        listSignature: buildListSignature(channel, 'codex')
      }
    }, null, 2), 'utf8');

    const result = await modelDetector.fetchModelsFromProvider(channel, 'codex');

    expect(result).toEqual({
      models: ['gpt-5', 'gpt-4o'],
      supported: true,
      cached: true,
      fallbackUsed: false,
      error: null,
      lastChecked
    });
  });

  test('returns expired model catalogs as stale data without a network request', async () => {
    const channel = { id: 'stale-channel', name: 'Stale Demo', baseUrl: 'https://api.openai.com/v1', apiKey: 'secret' };
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      'stale-channel': {
        fetchedModels: ['gpt-5'],
        lastChecked: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString(),
        listSignature: buildListSignature(channel, 'codex')
      }
    }, null, 2), 'utf8');
    const spy = vi.spyOn(https, 'request');

    await expect(modelDetector.fetchModelsFromProvider(channel, 'codex')).resolves.toEqual(expect.objectContaining({
      models: ['gpt-5'], cached: true, stale: true
    }));
    expect(spy).not.toHaveBeenCalled();
  });

  test('backs off after a 403 while retaining the previous model catalog', async () => {
    const channel = { id: 'backoff-channel', name: 'Backoff Demo', baseUrl: 'https://api.openai.com/v1', apiKey: 'secret' };
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      'backoff-channel': {
        fetchedModels: ['gpt-5'],
        lastChecked: new Date().toISOString(),
        listSignature: buildListSignature(channel, 'codex')
      }
    }, null, 2), 'utf8');
    const { calls } = mockHttpsRequestSequence([{ statusCode: 403, body: JSON.stringify({ error: {} }) }]);

    await modelDetector.fetchModelsFromProvider(channel, 'codex', { forceRefresh: true });
    const persisted = JSON.parse(fs.readFileSync(cachePath, 'utf8'))['backoff-channel'];
    expect(persisted.fetchedModels).toEqual(['gpt-5']);
    expect(persisted.modelListFailure).toEqual(expect.objectContaining({ statusCode: 403, retryAfter: expect.any(String) }));

    await expect(modelDetector.fetchModelsFromProvider(channel, 'codex')).resolves.toEqual(expect.objectContaining({
      models: ['gpt-5'], cached: true, stale: true, backoff: true, statusCode: 403
    }));
    expect(calls).toHaveLength(1);
  });

  test('force refresh bypasses model-list backoff and clears it after success', async () => {
    const channel = { id: 'force-channel', name: 'Force Demo', baseUrl: 'https://api.openai.com/v1', apiKey: 'secret' };
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      'force-channel': {
        fetchedModels: ['old-model'],
        lastChecked: new Date().toISOString(),
        listSignature: buildListSignature(channel, 'codex'),
        modelListFailure: { error: '访问被拒绝', retryAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
      }
    }, null, 2), 'utf8');
    const { calls } = mockHttpsRequestSequence([{ statusCode: 200, body: JSON.stringify({ data: [{ id: 'gpt-5' }] }) }]);

    await expect(modelDetector.fetchModelsFromProvider(channel, 'codex', { forceRefresh: true })).resolves.toEqual(expect.objectContaining({
      models: ['gpt-5'], cached: false
    }));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf8'))['force-channel'].modelListFailure).toBeNull();
  });

  test('invalidates the cached model catalog when channel credentials change', async () => {
    const original = { id: 'signature-channel', name: 'Signature Demo', baseUrl: 'https://api.openai.com/v1', apiKey: 'old-secret' };
    const changed = { ...original, apiKey: 'new-secret' };
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      'signature-channel': {
        fetchedModels: ['old-model'],
        lastChecked: new Date().toISOString(),
        listSignature: buildListSignature(original, 'codex')
      }
    }, null, 2), 'utf8');
    const { calls } = mockHttpsRequestSequence([{ statusCode: 200, body: JSON.stringify({ data: [{ id: 'new-model' }] }) }]);

    await expect(modelDetector.fetchModelsFromProvider(changed, 'codex')).resolves.toEqual(expect.objectContaining({ models: ['new-model'] }));
    expect(calls).toHaveLength(1);
  });

  test('returns explicit Cloudflare guidance when /v1/models is blocked by protection', async () => {
    const channel = {
      id: 'cloudflare-channel',
      name: 'Cloudflare Demo',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret'
    };

    mockHttpsRequestSequence([
      {
        statusCode: 403,
        body: '<html>cloudflare challenge cf-ray</html>'
      }
    ]);

    const result = await modelDetector.fetchModelsFromProvider(channel, 'codex');

    expect(result).toEqual({
      models: [],
      supported: false,
      cached: false,
      fallbackUsed: true,
      error: 'Cloudflare 防护拦截，无法自动获取模型列表',
      errorHint: '该 API 端点受 Cloudflare 保护，请手动填写模型名称',
      statusCode: 403
    });
  });

  test('returns authentication guidance when /v1/models responds with 401', async () => {
    const channel = {
      id: 'auth-channel',
      name: 'Auth Demo',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'bad-secret'
    };

    mockHttpsRequestSequence([
      {
        statusCode: 401,
        body: JSON.stringify({ error: { message: 'invalid api key' } })
      }
    ]);

    const result = await modelDetector.fetchModelsFromProvider(channel, 'codex');

    expect(result).toEqual({
      models: [],
      supported: true,
      cached: false,
      fallbackUsed: true,
      error: 'API 密钥认证失败',
      errorHint: '请检查 API 密钥是否正确配置',
      statusCode: 401
    });
  });

  test('returns rate-limit guidance when /v1/models responds with 429', async () => {
    const channel = {
      id: 'rate-limit-channel',
      name: 'Rate Limit Demo',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret'
    };

    mockHttpsRequestSequence([
      {
        statusCode: 429,
        body: JSON.stringify({ error: { message: 'too many requests' } })
      }
    ]);

    const result = await modelDetector.fetchModelsFromProvider(channel, 'codex');

    expect(result).toEqual({
      models: [],
      supported: true,
      cached: false,
      fallbackUsed: true,
      error: '请求频率限制',
      errorHint: '请稍后再试或联系服务提供商提高限额',
      statusCode: 429
    });
  });

  test('returns parse errors when the models endpoint body is invalid JSON', async () => {
    const channel = {
      id: 'parse-error-channel',
      name: 'Parse Demo',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret'
    };

    mockHttpsRequestSequence([
      {
        statusCode: 200,
        body: '{not-json'
      }
    ]);

    const result = await modelDetector.fetchModelsFromProvider(channel, 'codex');

    expect(result).toEqual(expect.objectContaining({
      models: [],
      supported: true,
      cached: false,
      fallbackUsed: true
    }));
    expect(result.error).toContain('Parse error:');
  });

  test('returns network and timeout failures from the models endpoint', async () => {
    const channel = {
      id: 'network-channel',
      name: 'Network Demo',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret'
    };

    mockHttpsRequestSequence([
      {
        type: 'error',
        message: 'socket hang up'
      },
      {
        type: 'timeout'
      }
    ]);
    const networkResult = await modelDetector.fetchModelsFromProvider(channel, 'codex');
    const timeoutResult = await modelDetector.fetchModelsFromProvider(channel, 'codex', { forceRefresh: true });

    expect(networkResult).toEqual({
      models: [],
      supported: true,
      cached: false,
      fallbackUsed: true,
      error: 'Network error: socket hang up'
    });
    expect(timeoutResult).toEqual({
      models: [],
      supported: true,
      cached: false,
      fallbackUsed: true,
      error: 'Request timeout'
    });
  });

  test('tests model availability from probe responses and caches the first available model', async () => {
    const channel = {
      id: 'probe-channel',
      name: 'Probe Demo',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret'
    };
    const { calls } = mockHttpsRequestSequence([
      {
        statusCode: 200,
        body: JSON.stringify({ id: 'ok' })
      },
      {
        statusCode: 404,
        body: JSON.stringify({ error: { message: 'model gpt-5-codex not found' } })
      },
      {
        statusCode: 200,
        body: JSON.stringify({ id: 'ok' })
      }
    ]);

    expect(await modelDetector.testModelAvailability(channel, 'codex', 'gpt-4o')).toBe(true);

    const probe = await modelDetector.probeModelAvailability(channel, 'codex');
    const cachedProbe = await modelDetector.probeModelAvailability(channel, 'codex');

    expect(probe).toEqual(expect.objectContaining({
      availableModels: ['gpt-4o'],
      preferredTestModel: 'gpt-4o',
      cached: false
    }));
    expect(cachedProbe).toEqual(expect.objectContaining({
      availableModels: ['gpt-4o'],
      preferredTestModel: 'gpt-4o',
      cached: true
    }));
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/responses',
      headers: expect.objectContaining({
        originator: 'codex_exec',
        'session-id': expect.any(String),
        'thread-id': expect.any(String),
        'x-codex-window-id': expect.any(String),
        'x-codex-turn-metadata': expect.any(String)
      })
    });
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf8'))['probe-channel']).toEqual(expect.objectContaining({
      availableModels: ['gpt-4o'],
      preferredTestModel: 'gpt-4o'
    }));
  });

  test('probes Claude official and custom endpoints through shared wire auth branches', async () => {
    const { calls } = mockHttpsRequestSequence([
      { statusCode: 200, body: JSON.stringify({ id: 'ok' }) },
      { statusCode: 200, body: JSON.stringify({ id: 'ok' }) }
    ]);

    await expect(modelDetector.testModelAvailability({
      id: 'claude-official',
      name: 'Claude Official',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'official-secret'
    }, 'claude', 'claude-sonnet-4-20250514')).resolves.toBe(true);

    await expect(modelDetector.testModelAvailability({
      id: 'claude-custom',
      name: 'Claude Custom',
      baseUrl: 'https://claude-proxy.example/custom',
      apiKey: 'custom-secret'
    }, 'claude', 'claude-sonnet-4-20250514')).resolves.toBe(true);

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/v1/messages?beta=true' });
    expect(calls[0].headers).toEqual(expect.objectContaining({
      'x-api-key': 'official-secret',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-app': 'cli',
      'user-agent': 'claude-cli/2.1.59 (external, cli)'
    }));
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].headers['anthropic-beta']).toContain('claude-code-20250219');
    expect(JSON.parse(calls[0].body)).toEqual(expect.objectContaining({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1,
      stream: false,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ping', cache_control: { type: 'ephemeral' } }] }]
    }));

    expect(calls[1]).toMatchObject({ method: 'POST', path: '/custom/v1/messages?beta=true' });
    expect(calls[1].headers).toEqual(expect.objectContaining({
      authorization: 'Bearer custom-secret',
      'anthropic-version': '2023-06-01',
      'user-agent': 'claude-cli/2.1.59 (external, cli)'
    }));
    expect(calls[1].headers['x-api-key']).toBeUndefined();
  });

  test('probes public Gemini through shared generateContent wire', async () => {
    const { calls } = mockHttpsRequestSequence([
      { statusCode: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) }
    ]);

    await expect(modelDetector.testModelAvailability({
      id: 'gemini-public',
      name: 'Gemini Public',
      baseUrl: 'https://generativelanguage.googleapis.com',
      providerApi: 'google-generative-ai',
      apiKey: 'gemini-secret'
    }, 'gemini', 'gemini-2.5-pro')).resolves.toBe(true);

    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1beta/models/gemini-2.5-pro:generateContent?key=gemini-secret'
    });
    expect(calls[0].headers).toEqual(expect.objectContaining({
      'x-goog-api-key': 'gemini-secret',
      'user-agent': 'google-genai-sdk/0.8.0'
    }));
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(JSON.parse(calls[0].body)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 1, temperature: 0 }
    });
  });

  test('probes CLI Gemini through shared Cloud Code Assist envelope', async () => {
    const { calls } = mockHttpsRequestSequence([
      { statusCode: 200, body: JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } }) }
    ]);

    await expect(modelDetector.testModelAvailability({
      id: 'gemini-cli',
      name: 'Gemini CLI',
      baseUrl: 'https://cloudcode-pa.googleapis.com',
      providerApi: 'google-gemini-cli',
      apiKey: 'cli-secret'
    }, 'gemini', 'gemini-2.5-pro')).resolves.toBe(true);

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/v1internal:generateContent' });
    expect(calls[0].headers).toEqual(expect.objectContaining({
      authorization: 'Bearer cli-secret',
      'x-goog-api-key': 'cli-secret',
      'user-agent': 'google-api-nodejs-client/9.15.1',
      'x-goog-api-client': 'gl-node/22.17.0',
      'client-metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI'
    }));
    expect(JSON.parse(calls[0].body)).toEqual({
      project: '',
      model: 'gemini-2.5-pro',
      request: {
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 }
      }
    });
  });
});
