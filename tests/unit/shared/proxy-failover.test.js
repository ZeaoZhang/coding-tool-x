'use strict';

const { Readable } = require('stream');
const { createFailoverProxy, isRetryableStatus, isRetryableError } = require('../../../src/shared/proxy-failover');

function createFakeRes() {
  const listeners = new Map();
  const add = (event, fn, once) => {
    const entries = listeners.get(event) || [];
    entries.push({ fn, once: Boolean(once) });
    listeners.set(event, entries);
  };
  const remove = (event, fn) => {
    const entries = listeners.get(event);
    if (!entries) return;
    const index = entries.findIndex(entry => entry.fn === fn);
    if (index >= 0) entries.splice(index, 1);
  };
  const emit = (event, ...args) => {
    const entries = listeners.get(event) || [];
    for (const entry of [...entries]) {
      if (entry.once) remove(event, entry.fn);
      entry.fn(...args);
    }
  };
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    statusCode: 200,
    headers: {},
    body: '',
    on: (event, fn) => { add(event, fn, false); return res; },
    once: (event, fn) => { add(event, fn, true); return res; },
    removeListener: (event, fn) => { remove(event, fn); return res; },
    emit,
    writeHead(statusCode, headers) {
      res.statusCode = statusCode;
      res.headers = headers || {};
      res.headersSent = true;
      return res;
    },
    write(chunk) {
      res.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      return true;
    },
    end(chunk) {
      if (chunk) res.write(chunk);
      if (!res.writableEnded) {
        res.writableEnded = true;
        emit('finish');
        emit('close');
      }
      return res;
    }
  };
  return res;
}

function createProxyRes(statusCode, body = '') {
  const proxyRes = Readable.from(body ? [Buffer.from(body)] : []);
  proxyRes.statusCode = statusCode;
  proxyRes.headers = { 'content-type': 'application/json', connection: 'keep-alive' };
  return proxyRes;
}

function createHarness(options = {}) {
  const proxyEvents = {};
  const attemptedWebCalls = [];
  const proxy = {
    on: (event, listener) => { proxyEvents[event] = listener; },
    web: (req, res, webOptions, callback) => {
      const step = (options.script || [])[attemptedWebCalls.length];
      // req 在重试时会被改写，按调用时刻快照渠道与模型
      attemptedWebCalls.push({
        req,
        res,
        options: webOptions,
        channelId: req.selectedChannel && req.selectedChannel.id,
        model: req.body && req.body.model
      });
      if (!step) throw new Error('unexpected proxy.web call');
      step({
        req,
        res,
        webOptions,
        callback,
        respond: proxyRes => proxyEvents.proxyRes(proxyRes, req, res)
      });
    }
  };

  const channels = options.channels || [
    { id: 'channel-1', name: 'channel one' },
    { id: 'channel-2', name: 'channel two' }
  ];
  const allocations = [];
  const releases = [];
  const retries = [];
  const finalResponses = [];
  const writeErrors = [];

  const failover = createFailoverProxy({
    source: 'test',
    createProxyServer: () => proxy,
    canRetry: options.canRetry || (() => true),
    maxAttempts: options.maxAttempts,
    resolveModelFallbackTargets: options.resolveModelFallbackTargets,
    allocate: async ({ excludeChannelIds, preferredChannelId = null, attempt }) => {
      allocations.push({ excludeChannelIds: [...excludeChannelIds], preferredChannelId, attempt });
      if (preferredChannelId) {
        return channels.find(channel => channel.id === preferredChannelId) || null;
      }
      return channels.find(channel => !excludeChannelIds.includes(channel.id)) || null;
    },
    release: channelId => releases.push(channelId),
    prepareAttempt: options.prepareAttempt
      || (() => ({ target: 'https://upstream.example.com', body: Buffer.from('{"a":1}') })),
    onFinalResponse: proxyRes => finalResponses.push(proxyRes.statusCode),
    onRetry: payload => retries.push(payload),
    writeError: (res, statusCode, error, channel) => {
      writeErrors.push({ statusCode, message: error && error.message, channelId: channel && channel.id });
      if (res.headersSent) return;
      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error && error.message }));
    }
  });

  return { failover, proxyEvents, webCalls: attemptedWebCalls, allocations, releases, retries, finalResponses, writeErrors };
}

function connectionError(code) {
  return Object.assign(new Error(`connect ${code}`), { code });
}

test('classifies retryable statuses and connection errors', () => {
  expect(isRetryableStatus(429)).toBe(true);
  expect(isRetryableStatus(500)).toBe(true);
  expect(isRetryableStatus(503)).toBe(true);
  expect(isRetryableStatus(400)).toBe(false);
  expect(isRetryableStatus(200)).toBe(false);
  expect(isRetryableError(connectionError('ECONNRESET'))).toBe(true);
  expect(isRetryableError(connectionError('ERR_STREAM_PREMATURE_CLOSE'))).toBe(true);
  expect(isRetryableError(connectionError('ENOTFOUND'))).toBe(false);
  expect(isRetryableError(null)).toBe(false);
});

test('replays the request on a second channel after a 429 and forwards the success', async () => {
  const harness = createHarness({
    script: [
      ({ respond }) => respond(createProxyRes(429, '{"error":"rate limited"}')),
      ({ respond }) => respond(createProxyRes(200, '{"ok":true}'))
    ]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(2);
  expect(harness.allocations[1].excludeChannelIds).toEqual(['channel-1']);
  expect(harness.webCalls[1].options.target).toBe('https://upstream.example.com');
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe('{"ok":true}');
  expect(res.headers.connection).toBeUndefined();
  expect(harness.releases).toEqual(['channel-1', 'channel-2']);
  expect(harness.retries).toHaveLength(1);
  expect(harness.retries[0]).toMatchObject({ statusCode: 429, attempt: 0 });
  expect(harness.finalResponses).toEqual([200]);
  expect(harness.writeErrors).toHaveLength(0);
});

test('does not retry a 400 response', async () => {
  const harness = createHarness({
    script: [({ respond }) => respond(createProxyRes(400, '{"error":"bad request"}'))]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(1);
  expect(res.statusCode).toBe(400);
  expect(res.body).toBe('{"error":"bad request"}');
  expect(harness.releases).toEqual(['channel-1']);
  expect(harness.retries).toHaveLength(0);
});

test('retries a connection error on the next channel', async () => {
  const harness = createHarness({
    script: [
      ({ callback }) => callback(connectionError('ECONNRESET')),
      ({ respond }) => respond(createProxyRes(200, '{"ok":true}'))
    ]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(2);
  expect(res.statusCode).toBe(200);
  expect(harness.releases).toEqual(['channel-1', 'channel-2']);
  expect(harness.retries).toHaveLength(1);
  expect(harness.retries[0].error.code).toBe('ECONNRESET');
});

test('does not retry once the downstream response headers were sent', async () => {
  const harness = createHarness({
    script: [
      ({ res, respond }) => {
        res.writeHead(429, { 'content-type': 'application/json' });
        respond(createProxyRes(429, '{"error":"rate limited"}'));
      }
    ]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(1);
  expect(res.statusCode).toBe(429);
  expect(harness.releases).toEqual(['channel-1']);
  expect(harness.retries).toHaveLength(0);
});

test('reports a 502 when every attempt fails with a connection error', async () => {
  const harness = createHarness({
    script: [
      ({ callback }) => callback(connectionError('ECONNREFUSED')),
      ({ callback }) => callback(connectionError('ECONNREFUSED'))
    ]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(2);
  expect(harness.writeErrors).toEqual([
    { statusCode: 502, message: 'connect ECONNREFUSED', channelId: 'channel-2' }
  ]);
  expect(res.statusCode).toBe(502);
  expect(harness.releases).toEqual(['channel-1', 'channel-2']);
});

test('reports the channel failure when a non-retryable connection error ends the request', async () => {
  const harness = createHarness({
    script: [({ callback }) => callback(connectionError('ENOTFOUND'))]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(1);
  expect(res.statusCode).toBe(502);
  // 终态失败也要进健康记录，否则坏渠道不会被降级
  expect(harness.retries).toHaveLength(1);
  expect(harness.retries[0]).toMatchObject({ attempt: 0, channel: { id: 'channel-1' } });
  expect(harness.retries[0].error.code).toBe('ENOTFOUND');
});

test('forwards the last upstream response when the retry budget is exhausted', async () => {
  const harness = createHarness({
    script: [
      ({ respond }) => respond(createProxyRes(429, '{"error":"first"}')),
      ({ respond }) => respond(createProxyRes(503, '{"error":"second"}'))
    ]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(2);
  expect(res.statusCode).toBe(503);
  expect(res.body).toBe('{"error":"second"}');
  expect(harness.retries).toHaveLength(1);
  expect(harness.writeErrors).toHaveLength(0);
});

test('leaves release and response ownership to a handled attempt', async () => {
  const harness = createHarness({
    prepareAttempt: () => ({ handled: true })
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(1);
  expect(harness.webCalls).toHaveLength(0);
  expect(harness.releases).toHaveLength(0);
  expect(harness.writeErrors).toHaveLength(0);
});

test('allocates a single channel when the request is not retryable', async () => {
  const harness = createHarness({
    canRetry: () => false,
    script: [({ respond }) => respond(createProxyRes(429, '{"error":"rate limited"}'))]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'm' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.allocations).toHaveLength(1);
  expect(res.statusCode).toBe(429);
  expect(harness.retries).toHaveLength(0);
});

test('restores the request snapshot before every attempt and clears the attempt record', async () => {
  const harness = createHarness({
    script: [
      ({ req, respond }) => {
        req.body.model = 'mutated-by-attempt-one';
        respond(createProxyRes(429, '{}'));
      },
      ({ req, respond }) => respond(createProxyRes(200, JSON.stringify({ model: req.body.model })))
    ]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'original' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(res.body).toBe('{"model":"original"}');
  expect(req.__failoverAttempt).toBeNull();
  expect(req.__releaseChannel).toBeInstanceOf(Function);
});

function createProxyResWithLength(statusCode, body) {
  const proxyRes = Readable.from(body ? [Buffer.from(body)] : []);
  proxyRes.statusCode = statusCode;
  proxyRes.headers = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body || ''))
  };
  return proxyRes;
}

function modelFallbackChannels() {
  return [
    { id: 'channel-1', name: 'primary', models: ['glm-4.6'] },
    { id: 'channel-2', name: 'fallback one', models: ['qwen-max'] },
    { id: 'channel-3', name: 'fallback two', models: ['deepseek-v4'] }
  ];
}

// 平台级链路：测试里用显式解析器代替 config.json
function platformResolver(model, targets) {
  return (channel, requested) => (requested === model ? targets : []);
}

test('routes to the configured fallback channel and rewrites the model when it is not declared', async () => {
  const harness = createHarness({
    channels: modelFallbackChannels(),
    resolveModelFallbackTargets: platformResolver('claude-opus-4-1', [{ channelId: 'channel-2', model: 'qwen-max' }]),
    script: [({ respond }) => respond(createProxyRes(200, '{"ok":true}'))]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'claude-opus-4-1' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  // 主渠道未声明该模型 → 不发上游，直接换到配置的渠道 + 模型
  expect(harness.webCalls).toHaveLength(1);
  expect(harness.webCalls[0].channelId).toBe('channel-2');
  expect(harness.webCalls[0].model).toBe('qwen-max');
  expect(harness.allocations[1]).toMatchObject({ preferredChannelId: 'channel-2' });
  expect(harness.releases).toEqual(['channel-1', 'channel-2']);
  expect(res.statusCode).toBe(200);
});

test('falls back to the configured channel + model when upstream reports the model does not exist', async () => {
  const channels = [
    { id: 'channel-1', models: ['glm-4.6'] },
    { id: 'channel-2', models: ['qwen-max'] }
  ];
  const harness = createHarness({
    channels,
    resolveModelFallbackTargets: platformResolver('glm-4.6', [{ channelId: 'channel-2', model: 'qwen-max' }]),
    script: [
      ({ respond }) => respond(createProxyResWithLength(404, '{"error":{"message":"model glm-4.6 not found"}}')),
      ({ respond }) => respond(createProxyRes(200, '{"ok":true}'))
    ]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'glm-4.6' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.webCalls).toHaveLength(2);
  expect(harness.webCalls[0].channelId).toBe('channel-1');
  expect(harness.webCalls[0].model).toBe('glm-4.6');
  expect(harness.webCalls[1].channelId).toBe('channel-2');
  expect(harness.webCalls[1].model).toBe('qwen-max');
  expect(harness.allocations[1]).toMatchObject({ preferredChannelId: 'channel-2' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe('{"ok":true}');
});

test('detects model-unavailable responses that arrive chunked (no content-length)', async () => {
  const channels = [
    { id: 'channel-1', models: ['glm-4.6'] },
    { id: 'channel-2', models: ['qwen-max'] }
  ];
  const harness = createHarness({
    channels,
    resolveModelFallbackTargets: platformResolver('glm-4.6', [{ channelId: 'channel-2', model: 'qwen-max' }]),
    script: [
      // createProxyRes 不带 content-length，模拟 chunked 上游
      ({ respond }) => respond(createProxyRes(404, '{"error":{"message":"model glm-4.6 not found"}}')),
      ({ respond }) => respond(createProxyRes(200, '{"ok":true}'))
    ]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'glm-4.6' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.webCalls).toHaveLength(2);
  expect(harness.webCalls[1].channelId).toBe('channel-2');
  expect(harness.webCalls[1].model).toBe('qwen-max');
  expect(res.statusCode).toBe(200);
});

test('forwards an unrelated 400 without consuming a fallback target', async () => {
  const harness = createHarness({
    channels: modelFallbackChannels(),
    resolveModelFallbackTargets: platformResolver('glm-4.6', [{ channelId: 'channel-2', model: 'qwen-max' }]),
    script: [({ respond }) => respond(createProxyResWithLength(400, '{"error":{"message":"max_tokens is required"}}'))]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'glm-4.6' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.webCalls).toHaveLength(1);
  expect(harness.allocations).toHaveLength(1);
  expect(res.statusCode).toBe(400);
  expect(res.body).toBe('{"error":{"message":"max_tokens is required"}}');
});

test('uses the platform-provided target resolver when channels carry no rules', async () => {
  const harness = createHarness({
    channels: [
      { id: 'channel-1', models: ['glm-4.6'] },
      { id: 'channel-2', models: ['qwen-max'] }
    ],
    resolveModelFallbackTargets: (channel, model) => (
      model === 'claude-opus-4-1' ? [{ channelId: 'channel-2', model: 'qwen-max' }] : []
    ),
    script: [({ respond }) => respond(createProxyRes(200, '{"ok":true}'))]
  });
  const req = { method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, body: { model: 'claude-opus-4-1' } };
  const res = createFakeRes();

  await harness.failover.handle(req, res);

  expect(harness.webCalls).toHaveLength(1);
  expect(harness.webCalls[0].channelId).toBe('channel-2');
  expect(harness.webCalls[0].model).toBe('qwen-max');
  expect(harness.allocations[1]).toMatchObject({ preferredChannelId: 'channel-2' });
});
