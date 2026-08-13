const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');
const { createOmpGateway } = require('../../../src/server/services/omp-gateway');
const { prepareManagedOmpChannels } = require('../../../src/server/services/omp-gateway-routing');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function request({ port, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('OMP gateway data plane', () => {
  it('reports a bind failure without leaving a listening gateway behind', async () => {
    const occupied = http.createServer();
    const occupiedPort = await listen(occupied);
    const gateway = createOmpGateway({ getChannels: () => [] });

    try {
      await expect(gateway.start({
        host: '127.0.0.1',
        port: occupiedPort,
        secret: 'occupied-port-secret'
      })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(gateway.status()).toEqual(expect.objectContaining({
        listening: false,
        port: null,
        inflightRequests: 0
      }));
    } finally {
      await close(occupied);
    }
  });

  it('routes a native OMP request byte-for-byte and replaces only the local credential', async () => {
    let received = null;
    const upstream = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        received = {
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          customHeader: req.headers['x-upstream-header'],
          body: Buffer.concat(chunks)
        };
        res.writeHead(201, {
          'content-type': 'application/json',
          'x-upstream-response': 'yes'
        });
        res.end('{"ok":true}');
      });
    });
    const upstreamPort = await listen(upstream);
    const channel = {
      id: 'channel-a',
      name: 'OpenAI A',
      providerKey: 'openai',
      providerApi: 'openai-responses',
      routingGroup: 'primary',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1?api-version=2026-01-01`,
      apiKey: 'upstream-key',
      headers: {
        'x-upstream-header': 'from-channel'
      },
      enabled: true,
      models: [{ id: 'gpt-5' }],
      model: 'gpt-5'
    };
    const secret = 'gateway-test-secret';
    const allocateChannel = vi.fn(async () => channel);
    const releaseChannel = vi.fn();
    const recordSuccess = vi.fn();
    const gateway = createOmpGateway({
      getChannels: () => [channel],
      allocateChannel,
      releaseChannel,
      recordSuccess,
      recordFailure: vi.fn()
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const prepared = prepareManagedOmpChannels([channel], {
        host: '127.0.0.1',
        port: status.port,
        secret
      });
      const route = prepared.routes[0];
      const body = Buffer.from('{"model":"gpt-5","input":"hello"}');

      const response = await request({
        port: status.port,
        path: `/omp/${route.token}/responses`,
        headers: {
          authorization: `Bearer ${route.capability}`,
          'content-type': 'application/json'
        },
        body
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['x-upstream-response']).toBe('yes');
      expect(response.body).toEqual(Buffer.from('{"ok":true}'));
      expect(received).toEqual({
        method: 'POST',
        url: '/v1/responses?api-version=2026-01-01',
        authorization: 'Bearer upstream-key',
        customHeader: 'from-channel',
        body
      });
      expect(allocateChannel).toHaveBeenCalledWith(expect.objectContaining({
        source: 'omp',
        routingGroup: 'primary',
        providerKey: 'openai',
        providerApi: 'openai-responses',
        candidateIds: ['channel-a']
      }));
      expect(releaseChannel).toHaveBeenCalledTimes(1);
      expect(recordSuccess).toHaveBeenCalledWith('channel-a', 'omp');
    } finally {
      await gateway.stop();
      await close(upstream);
    }
  });

  it('maps managed Codex Responses requests to an OpenAI-compatible v1 endpoint', async () => {
    let receivedPath = null;
    const upstream = http.createServer((req, res) => {
      receivedPath = req.url;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    const upstreamPort = await listen(upstream);
    const channel = {
      id: 'codex-channel',
      name: 'Codex Edge',
      providerKey: 'codex-edge',
      providerApi: 'openai-codex-responses',
      routingGroup: 'codex',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1?api-version=2026-01-01`,
      apiKey: 'upstream-key',
      enabled: true,
      models: [{ id: 'gpt-5.5' }],
      model: 'gpt-5.5'
    };
    const secret = 'codex-path-secret';
    const gateway = createOmpGateway({
      getChannels: () => [channel],
      allocateChannel: vi.fn(async () => channel),
      releaseChannel: vi.fn(),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn()
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels([channel], {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];
      const response = await request({
        port: status.port,
        path: `/omp/${route.token}/codex/responses?foo=bar&api_key=must-not-forward`,
        headers: {
          authorization: `Bearer ${route.capability}`,
          'content-type': 'application/json'
        },
        body: Buffer.from('{"model":"gpt-5.5"}')
      });

      expect(response.statusCode).toBe(200);
      expect(receivedPath).toBe('/v1/responses?api-version=2026-01-01&foo=bar');
    } finally {
      await gateway.stop();
      await close(upstream);
    }
  });

  it('fails closed when the local gateway capability is missing or incorrect', async () => {
    let upstreamRequests = 0;
    const upstream = http.createServer((_req, res) => {
      upstreamRequests++;
      res.end('unexpected');
    });
    const upstreamPort = await listen(upstream);
    const channel = {
      id: 'channel-auth',
      name: 'Authenticated',
      providerKey: 'openai',
      providerApi: 'openai-responses',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-key',
      enabled: true,
      model: 'gpt-5'
    };
    const secret = 'auth-gateway-secret';
    const gateway = createOmpGateway({
      getChannels: () => [channel],
      allocateChannel: vi.fn(async () => channel),
      releaseChannel: vi.fn(),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn()
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels([channel], {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];
      const response = await request({
        port: status.port,
        path: `/omp/${route.token}/responses`,
        headers: {
          authorization: 'Bearer wrong-capability',
          'content-type': 'application/json'
        },
        body: Buffer.from('{"model":"gpt-5"}')
      });

      expect(response.statusCode).toBe(401);
      expect(upstreamRequests).toBe(0);
    } finally {
      await gateway.stop();
      await close(upstream);
    }
  });

  it('cancels the upstream stream and releases its lease once when OMP disconnects', async () => {
    let upstreamClosed = false;
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"response.output_text.delta","delta":"hello"}\n\n');
      res.once('close', () => {
        upstreamClosed = true;
      });
    });
    const upstreamPort = await listen(upstream);
    const channel = {
      id: 'channel-stream',
      name: 'Streaming',
      providerKey: 'openai',
      providerApi: 'openai-responses',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-key',
      enabled: true,
      model: 'gpt-5'
    };
    const releaseChannel = vi.fn();
    const secret = 'abort-gateway-secret';
    const gateway = createOmpGateway({
      getChannels: () => [channel],
      allocateChannel: vi.fn(async () => channel),
      releaseChannel,
      recordSuccess: vi.fn(),
      recordFailure: vi.fn()
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels([channel], {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];
      await new Promise((resolve, reject) => {
        const downstream = http.request({
          host: '127.0.0.1',
          port: status.port,
          method: 'POST',
          path: `/omp/${route.token}/responses`,
          headers: {
            authorization: `Bearer ${route.capability}`,
            'content-type': 'application/json'
          }
        }, (res) => {
          res.once('data', () => {
            res.destroy();
            resolve();
          });
        });
        downstream.once('error', reject);
        downstream.end('{"model":"gpt-5"}');
      });

      await vi.waitFor(() => {
        expect(upstreamClosed).toBe(true);
        expect(releaseChannel).toHaveBeenCalledTimes(1);
      });
    } finally {
      await gateway.stop();
      await close(upstream);
    }
  });

  it('does not start an upstream request when the client disconnects while allocation is queued', async () => {
    let upstreamRequests = 0;
    const upstream = http.createServer((_req, res) => {
      upstreamRequests++;
      res.end('unexpected');
    });
    const upstreamPort = await listen(upstream);
    const channel = {
      id: 'channel-queued',
      providerKey: 'openai',
      providerApi: 'openai-responses',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-key',
      enabled: true,
      model: 'gpt-5'
    };
    let resolveAllocation;
    const allocateChannel = vi.fn(() => new Promise((resolve) => {
      resolveAllocation = resolve;
    }));
    const releaseChannel = vi.fn();
    const secret = 'queued-abort-secret';
    const gateway = createOmpGateway({
      getChannels: () => [channel],
      allocateChannel,
      releaseChannel,
      recordSuccess: vi.fn(),
      recordFailure: vi.fn()
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels([channel], {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];
      const downstream = http.request({
        host: '127.0.0.1',
        port: status.port,
        method: 'POST',
        path: `/omp/${route.token}/responses`,
        headers: {
          authorization: `Bearer ${route.capability}`,
          'content-type': 'application/json'
        }
      });
      downstream.on('error', () => {});
      downstream.end('{"model":"gpt-5"}');

      await vi.waitFor(() => expect(allocateChannel).toHaveBeenCalledTimes(1));
      downstream.destroy();
      await new Promise(resolve => setImmediate(resolve));
      resolveAllocation(channel);
      await new Promise(resolve => setTimeout(resolve, 30));

      expect(upstreamRequests).toBe(0);
      expect(releaseChannel).toHaveBeenCalledTimes(1);
    } finally {
      await gateway.stop({ forceAfterMs: 100 });
      await close(upstream);
    }
  });

  it('drains an in-flight response before closing the listener', async () => {
    let finishUpstream;
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"ok":');
      finishUpstream = () => res.end('true}');
    });
    const upstreamPort = await listen(upstream);
    const channel = {
      id: 'channel-drain',
      name: 'Drain',
      providerKey: 'openai',
      providerApi: 'openai-responses',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-key',
      enabled: true,
      model: 'gpt-5'
    };
    const releaseChannel = vi.fn();
    const secret = 'drain-gateway-secret';
    const gateway = createOmpGateway({
      getChannels: () => [channel],
      allocateChannel: vi.fn(async () => channel),
      releaseChannel,
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
      publishUsageLog: vi.fn()
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels([channel], {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];
      const responsePromise = request({
        port: status.port,
        path: `/omp/${route.token}/responses`,
        headers: {
          authorization: `Bearer ${route.capability}`,
          'content-type': 'application/json'
        },
        body: Buffer.from('{"model":"gpt-5"}')
      });
      await vi.waitFor(() => {
        expect(gateway.status().inflightRequests).toBe(1);
        expect(finishUpstream).toBeTypeOf('function');
      });

      let stopped = false;
      const stopPromise = gateway.stop({ forceAfterMs: 2000 }).then(() => {
        stopped = true;
      });
      await new Promise(resolve => setImmediate(resolve));
      expect(stopped).toBe(false);

      finishUpstream();
      await expect(responsePromise).resolves.toEqual(expect.objectContaining({
        statusCode: 200,
        body: Buffer.from('{"ok":true}')
      }));
      await stopPromise;
      expect(releaseChannel).toHaveBeenCalledTimes(1);
      expect(gateway.status()).toEqual(expect.objectContaining({
        listening: false,
        inflightRequests: 0
      }));
    } finally {
      await gateway.stop().catch(() => {});
      await close(upstream);
    }
  });

  it('proxies OMP websocket upgrades through the selected channel', async () => {
    const upstreamServer = http.createServer();
    const upstreamWs = new WebSocketServer({ noServer: true });
    let upgrade = null;
    upstreamServer.on('upgrade', (req, socket, head) => {
      upgrade = {
        url: req.url,
        authorization: req.headers.authorization
      };
      upstreamWs.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', message => ws.send(message));
      });
    });
    const upstreamPort = await listen(upstreamServer);
    const channel = {
      id: 'codex-a',
      name: 'Codex A',
      providerKey: 'openai-codex',
      providerApi: 'openai-codex-responses',
      routingGroup: 'codex',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'codex-upstream-key',
      enabled: true,
      models: [{ id: 'gpt-5-codex' }],
      model: 'gpt-5-codex'
    };
    const secret = 'websocket-gateway-secret';
    const releaseChannel = vi.fn();
    const gateway = createOmpGateway({
      getChannels: () => [channel],
      allocateChannel: vi.fn(async () => channel),
      releaseChannel,
      recordSuccess: vi.fn(),
      recordFailure: vi.fn()
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels([channel], {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];

      const reply = await new Promise((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${status.port}/omp/${route.token}/realtime`,
          { headers: { authorization: `Bearer ${route.capability}` } }
        );
        ws.once('open', () => ws.send('ping'));
        ws.once('message', (message) => {
          resolve(message.toString());
          ws.close();
        });
        ws.once('error', reject);
      });

      expect(reply).toBe('ping');
      expect(upgrade).toEqual({
        url: '/v1/realtime',
        authorization: 'Bearer codex-upstream-key'
      });
      await vi.waitFor(() => expect(releaseChannel).toHaveBeenCalledTimes(1));
    } finally {
      await gateway.stop();
      upstreamWs.close();
      await close(upstreamServer);
    }
  });

  it('switches once inside the same routing group before committing a retryable response', async () => {
    const firstUpstream = http.createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"busy"}');
    });
    const secondUpstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"channel":"second"}');
    });
    const firstPort = await listen(firstUpstream);
    const secondPort = await listen(secondUpstream);
    const base = {
      providerKey: 'openai',
      providerApi: 'openai-responses',
      routingGroup: 'primary',
      apiKey: 'upstream-key',
      enabled: true,
      models: [{ id: 'gpt-5' }],
      model: 'gpt-5'
    };
    const channels = [
      { ...base, id: 'first', name: 'First', baseUrl: `http://127.0.0.1:${firstPort}/v1` },
      { ...base, id: 'second', name: 'Second', baseUrl: `http://127.0.0.1:${secondPort}/v1` }
    ];
    const allocateChannel = vi.fn(async (options) => {
      return options.excludeChannelIds.includes('first') ? channels[1] : channels[0];
    });
    const releaseChannel = vi.fn();
    const recordSuccess = vi.fn();
    const recordFailure = vi.fn();
    const publishFailureLog = vi.fn();
    const secret = 'retry-gateway-secret';
    const gateway = createOmpGateway({
      getChannels: () => channels,
      allocateChannel,
      releaseChannel,
      recordSuccess,
      recordFailure,
      publishFailureLog
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels(channels, {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];
      const response = await request({
        port: status.port,
        path: `/omp/${route.token}/responses`,
        headers: {
          authorization: `Bearer ${route.capability}`,
          'content-type': 'application/json'
        },
        body: Buffer.from('{"model":"gpt-5"}')
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.toString()).toBe('{"channel":"second"}');
      expect(allocateChannel).toHaveBeenCalledTimes(2);
      expect(allocateChannel).toHaveBeenNthCalledWith(2, expect.objectContaining({
        candidateIds: ['first', 'second'],
        excludeChannelIds: ['first']
      }));
      expect(releaseChannel.mock.calls).toEqual([
        ['first', 'omp'],
        ['second', 'omp']
      ]);
      expect(recordFailure).toHaveBeenCalledWith('first', 'omp');
      expect(recordSuccess).toHaveBeenCalledWith('second', 'omp');
      expect(publishFailureLog).toHaveBeenCalledWith(expect.objectContaining({
        source: 'omp',
        channel: 'First',
        model: 'gpt-5',
        statusCode: 503,
        stage: 'dynamic-switch',
        routingGroup: 'primary'
      }));
    } finally {
      await gateway.stop();
      await close(firstUpstream);
      await close(secondUpstream);
    }
  });

  it('publishes managed streaming usage from the gateway with route and actual-channel context', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end([
        'event: response.completed',
        'data: {"type":"response.completed","response":{"model":"gpt-5.1","usage":{"input_tokens":12,"output_tokens":7,"total_tokens":19}}}',
        '',
        ''
      ].join('\n'));
    });
    const upstreamPort = await listen(upstream);
    const channel = {
      id: 'channel-usage',
      name: 'Usage Channel',
      providerKey: 'openai',
      providerApi: 'openai-responses',
      routingGroup: 'usage',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-key',
      enabled: true,
      model: 'gpt-5'
    };
    const publishUsageLog = vi.fn();
    const secret = 'usage-gateway-secret';
    const gateway = createOmpGateway({
      getChannels: () => [channel],
      allocateChannel: vi.fn(async () => channel),
      releaseChannel: vi.fn(),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
      publishUsageLog
    });

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels([channel], {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];
      const response = await request({
        port: status.port,
        path: `/omp/${route.token}/responses`,
        headers: {
          authorization: `Bearer ${route.capability}`,
          'content-type': 'application/json'
        },
        body: Buffer.from('{"model":"gpt-5"}')
      });

      expect(response.statusCode).toBe(200);
      expect(publishUsageLog).toHaveBeenCalledWith(expect.objectContaining({
        source: 'omp',
        channel: 'Usage Channel',
        channelId: 'channel-usage',
        originalProvider: 'openai',
        originalModel: 'gpt-5',
        model: 'gpt-5.1',
        providerApi: 'openai-responses',
        routingGroup: 'usage',
        tokens: expect.objectContaining({
          input: 12,
          output: 7,
          total: 19
        })
      }));
    } finally {
      await gateway.stop();
      await close(upstream);
    }
  });

  it('allocates only same-group channels that expose the requested model', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    const upstreamPort = await listen(upstream);
    const base = {
      providerKey: 'openai',
      providerApi: 'openai-responses',
      routingGroup: 'primary',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-key',
      enabled: true
    };
    const channels = [
      {
        ...base,
        id: 'gpt-4-only',
        name: 'GPT-4 only',
        allowedModels: ['gpt-4.1'],
        models: [{ id: 'gpt-4.1' }],
        model: 'gpt-4.1'
      },
      {
        ...base,
        id: 'gpt-5',
        name: 'GPT-5',
        allowedModels: ['gpt-5'],
        models: [{ id: 'gpt-5', reasoning: true, supportsTools: true }],
        model: 'gpt-5'
      }
    ];
    const allocateChannel = vi.fn(async () => channels[1]);
    const gateway = createOmpGateway({
      getChannels: () => channels,
      allocateChannel,
      releaseChannel: vi.fn(),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn()
    });
    const secret = 'model-filter-secret';

    try {
      const status = await gateway.start({ port: 0, secret });
      const route = prepareManagedOmpChannels(channels, {
        host: '127.0.0.1',
        port: status.port,
        secret
      }).routes[0];

      await request({
        port: status.port,
        path: `/omp/${route.token}/responses`,
        headers: {
          authorization: `Bearer ${route.capability}`,
          'content-type': 'application/json'
        },
        body: Buffer.from('{"model":"gpt-5","input":"hello"}')
      });

      expect(allocateChannel).toHaveBeenCalledWith(expect.objectContaining({
        modelId: 'gpt-5',
        candidateIds: ['gpt-5']
      }));
    } finally {
      await gateway.stop();
      await close(upstream);
    }
  });
});
