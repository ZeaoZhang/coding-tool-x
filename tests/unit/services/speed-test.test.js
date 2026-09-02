'use strict';

const Module = require('module');
const http = require('http');
const path = require('path');

// ─── Stub heavy dependencies into require.cache before loading speed-test ────
// speed-test uses top-level require(), so we must pre-populate the cache.

function stubModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
    parent: null,
    children: [],
    paths: [],
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

stubModule(
  path.join(PROJECT_ROOT, 'src/server/services/model-detector.js'),
  { probeModelAvailability: () => Promise.resolve(null) }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/platforms/drivers/claude/channels-implementation.js'),
  { getEffectiveApiKey: () => null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/platforms/drivers/codex/channels-implementation.js'),
  { getEffectiveApiKey: () => null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/platforms/drivers/gemini/channels-implementation.js'),
  { getEffectiveApiKey: () => null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/platforms/drivers/opencode/channels-implementation.js'),
  { getEffectiveApiKey: () => null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/platforms/drivers/omp/channels-implementation.js'),
  { getEffectiveApiKey: (channel) => channel?.apiKey || null }
);
stubModule(
  path.join(PROJECT_ROOT, 'src/server/services/request-logger.js'),
  { loadClaudeRequestTemplate: () => null }
);

const {
  testChannelSpeed,
  getLatencyLevel,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit,
} = require('../../../src/server/services/speed-test');

async function withJsonServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function readRequestBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString('utf8');
  }
  return body;
}

// ─── getLatencyLevel ──────────────────────────────────────────────────────────
describe('getLatencyLevel', () => {
  test('null → "unknown"', () => {
    expect(getLatencyLevel(null)).toBe('unknown');
  });

  test('undefined → "unknown"', () => {
    expect(getLatencyLevel(undefined)).toBe('unknown');
  });

  test('NaN → "unknown"', () => {
    expect(getLatencyLevel(NaN)).toBe('unknown');
  });

  test('Infinity → "unknown"', () => {
    expect(getLatencyLevel(Infinity)).toBe('unknown');
  });

  test('100ms → "excellent"', () => {
    expect(getLatencyLevel(100)).toBe('excellent');
  });

  test('299ms → "excellent" (boundary below 300)', () => {
    expect(getLatencyLevel(299)).toBe('excellent');
  });

  test('300ms → "good" (boundary at 300)', () => {
    expect(getLatencyLevel(300)).toBe('good');
  });

  test('499ms → "good" (boundary below 500)', () => {
    expect(getLatencyLevel(499)).toBe('good');
  });

  test('500ms → "fair" (boundary at 500)', () => {
    expect(getLatencyLevel(500)).toBe('fair');
  });

  test('799ms → "fair" (boundary below 800)', () => {
    expect(getLatencyLevel(799)).toBe('fair');
  });

  test('800ms → "poor" (boundary at 800)', () => {
    expect(getLatencyLevel(800)).toBe('poor');
  });

  test('1500ms → "poor"', () => {
    expect(getLatencyLevel(1500)).toBe('poor');
  });
});

// ─── sanitizeBatchConcurrency ────────────────────────────────────────────────
describe('sanitizeBatchConcurrency', () => {
  test('null → default (2)', () => {
    expect(sanitizeBatchConcurrency(null)).toBe(2);
  });

  test('0 → default (2)', () => {
    expect(sanitizeBatchConcurrency(0)).toBe(2);
  });

  test('negative → default (2)', () => {
    expect(sanitizeBatchConcurrency(-1)).toBe(2);
  });

  test('NaN → default (2)', () => {
    expect(sanitizeBatchConcurrency(NaN)).toBe(2);
  });

  test('valid value 3 → 3', () => {
    expect(sanitizeBatchConcurrency(3)).toBe(3);
  });

  test('value > 5 → clamped to 5', () => {
    expect(sanitizeBatchConcurrency(10)).toBe(5);
  });

  test('float 1.7 → rounded to 2', () => {
    expect(sanitizeBatchConcurrency(1.7)).toBe(2);
  });

  test('custom default value used when invalid', () => {
    expect(sanitizeBatchConcurrency(null, 4)).toBe(4);
  });
});

// ─── runWithConcurrencyLimit ─────────────────────────────────────────────────
describe('runWithConcurrencyLimit', () => {
  test('empty array → []', async () => {
    const result = await runWithConcurrencyLimit([], 2, () => Promise.resolve('x'));
    expect(result).toEqual([]);
  });

  test('non-array items treated as empty → []', async () => {
    const result = await runWithConcurrencyLimit(null, 2, () => Promise.resolve('x'));
    expect(result).toEqual([]);
  });

  test('preserves result order matching input order', async () => {
    const items = [30, 10, 20]; // different simulated delays
    const result = await runWithConcurrencyLimit(items, 3, async (ms) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return ms;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  test('respects concurrency limit (at most N tasks run in parallel)', async () => {
    let activeCount = 0;
    let maxConcurrent = 0;
    const items = [1, 2, 3, 4, 5, 6];
    const concurrency = 2;

    await runWithConcurrencyLimit(items, concurrency, async (item) => {
      activeCount += 1;
      maxConcurrent = Math.max(maxConcurrent, activeCount);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeCount -= 1;
      return item;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(concurrency);
  });

  test('sequential execution completes all items', async () => {
    const items = ['a', 'b', 'c'];
    const result = await runWithConcurrencyLimit(items, 1, async (item) => item.toUpperCase());
    expect(result).toEqual(['A', 'B', 'C']);
  });
});

describe('testChannelSpeed', () => {
  test('uses OMP channel credentials while keeping the configured request format', async () => {
    let seenAuth = null;
    let seenPath = null;
    const server = await withJsonServer((req, res) => {
      seenAuth = req.headers.authorization;
      seenPath = req.url;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'ok' }));
    });

    try {
      const result = await testChannelSpeed(
        {
          id: 'omp-1',
          name: 'OMP One',
          baseUrl: `${server.baseUrl}/v1`,
          apiKey: 'omp-secret',
          model: 'gpt-5'
        },
        5000,
        'codex',
        { authSourceType: 'omp' }
      );

      expect(result.success).toBe(true);
      expect(seenAuth).toBe('Bearer omp-secret');
      expect(seenPath).toBe('/v1/responses');
    } finally {
      await server.close();
    }
  });

  test('sends Claude official speed test through shared streaming messages wire', async () => {
    let seen = null;
    const server = await withJsonServer(async (req, res) => {
      seen = { url: req.url, headers: req.headers, body: await readRequestBody(req) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('event: message_start\ndata: {"type":"message_start"}\n\n');
    });

    try {
      const result = await testChannelSpeed({
        id: 'claude-speed',
        name: 'Claude Speed',
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'claude-secret',
        model: 'claude-sonnet-4-20250514'
      }, 5000, 'claude', { authSourceType: 'omp' });

      expect(result.success).toBe(true);
      expect(seen.url).toBe('/v1/messages?beta=true');
      expect(seen.headers['x-api-key']).toBeUndefined();
      expect(seen.headers.authorization).toBe('Bearer claude-secret');
      expect(seen.headers['anthropic-version']).toBe('2023-06-01');
      expect(seen.headers['anthropic-beta']).toContain('claude-code-20250219');
      expect(seen.headers['user-agent']).toBe('claude-cli/2.1.59 (external, cli)');
      expect(JSON.parse(seen.body)).toEqual(expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        stream: true,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi', cache_control: { type: 'ephemeral' } }] }]
      }));
    } finally {
      await server.close();
    }
  });

  test('sends public Gemini speed test through shared generateContent wire', async () => {
    let seen = null;
    const server = await withJsonServer(async (req, res) => {
      seen = { url: req.url, headers: req.headers, body: await readRequestBody(req) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    });

    try {
      const result = await testChannelSpeed({
        id: 'gemini-public-speed',
        name: 'Gemini Public Speed',
        baseUrl: server.baseUrl,
        providerApi: 'google-generative-ai',
        apiKey: 'gemini-secret',
        model: 'gemini-2.5-pro'
      }, 5000, 'gemini', { authSourceType: 'omp' });

      expect(result.success).toBe(true);
      expect(seen.url).toBe('/v1beta/models/gemini-2.5-pro:generateContent?key=gemini-secret');
      expect(seen.headers['x-goog-api-key']).toBe('gemini-secret');
      expect(seen.headers.authorization).toBeUndefined();
      expect(seen.headers['user-agent']).toBe('google-genai-sdk/0.8.0');
      expect(JSON.parse(seen.body)).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 }
      });
    } finally {
      await server.close();
    }
  });

  test('sends explicit CLI Gemini speed test through shared Cloud Code Assist envelope', async () => {
    let seen = null;
    const server = await withJsonServer(async (req, res) => {
      seen = { url: req.url, headers: req.headers, body: await readRequestBody(req) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } }));
    });

    try {
      const result = await testChannelSpeed({
        id: 'gemini-cli-speed',
        name: 'Gemini CLI Speed',
        baseUrl: server.baseUrl,
        providerApi: 'google-gemini-cli',
        apiKey: 'cli-secret',
        model: 'gemini-2.5-pro'
      }, 5000, 'gemini', { authSourceType: 'omp' });

      expect(result.success).toBe(true);
      expect(seen.url).toBe('/v1internal:generateContent');
      expect(seen.headers.authorization).toBe('Bearer cli-secret');
      expect(seen.headers['x-goog-api-key']).toBe('cli-secret');
      expect(seen.headers['user-agent']).toBe('google-api-nodejs-client/9.15.1');
      expect(seen.headers['x-goog-api-client']).toBe('gl-node/22.17.0');
      expect(seen.headers['client-metadata']).toBe('ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI');
      expect(JSON.parse(seen.body)).toEqual({
        project: '',
        model: 'gemini-2.5-pro',
        request: {
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 }
        }
      });
    } finally {
      await server.close();
    }
  });

  test('does not retry explicit public Gemini speed tests as CLI on route failure', async () => {
    const seenUrls = [];
    const server = await withJsonServer(async (req, res) => {
      seenUrls.push(req.url);
      await readRequestBody(req);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });

    try {
      const result = await testChannelSpeed({
        id: 'gemini-public-no-fallback',
        name: 'Gemini Public No Fallback',
        baseUrl: server.baseUrl,
        providerApi: 'google-generative-ai',
        apiKey: 'gemini-secret',
        model: 'gemini-2.5-pro'
      }, 5000, 'gemini', { authSourceType: 'omp' });

      expect(result.success).toBe(false);
      expect(seenUrls).toEqual(['/v1beta/models/gemini-2.5-pro:generateContent?key=gemini-secret']);
    } finally {
      await server.close();
    }
  });
});
