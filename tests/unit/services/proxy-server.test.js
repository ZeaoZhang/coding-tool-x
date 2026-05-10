// globals: true in vitest.config.js

const http = require('http');
const path = require('path');

const PROXY_SERVER_PATH = '../../../src/server/proxy-server';
const CLAUDE_OPENAI_GATEWAY_PATH = '../../../src/server/services/claude-openai-gateway';

let proxyPort = 9960;
let proxyModule = null;
let upstreamServer = null;
let allocateChannel;
let releaseChannel;
let getSchedulerState;
let recordSuccess;
let recordFailure;
let broadcastLog;
let broadcastSchedulerState;
let loadConfig;
let resolveModelPricing;
let recordRequest;
let saveProxyStartTime;
let clearProxyStartTime;
let getProxyStartTime;
let getProxyRuntime;
let createDecodedStream;
let eventBus;
let getEffectiveApiKey;
let persistProxyRequestSnapshot;
let persistClaudeRequestTemplate;
let loadClaudeRequestTemplate;
let publishUsageLog;
let publishFailureLog;
let redirectModel;
let normalizeGatewaySourceType;
let ensureOpenAiStreamUsage;

function createStubs() {
  allocateChannel = vi.fn();
  releaseChannel = vi.fn();
  getSchedulerState = vi.fn(() => ({}));
  recordSuccess = vi.fn();
  recordFailure = vi.fn();
  broadcastLog = vi.fn();
  broadcastSchedulerState = vi.fn();
  loadConfig = vi.fn(() => ({ ports: { proxy: proxyPort } }));
  resolveModelPricing = vi.fn(() => ({ input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 }));
  recordRequest = vi.fn();
  saveProxyStartTime = vi.fn();
  clearProxyStartTime = vi.fn();
  getProxyStartTime = vi.fn(() => null);
  getProxyRuntime = vi.fn(() => null);
  createDecodedStream = vi.fn((response) => response);
  eventBus = {
    emit: vi.fn(),
    emitSync: vi.fn(),
    on: vi.fn()
  };
  getEffectiveApiKey = vi.fn(() => 'test-key');
  persistProxyRequestSnapshot = vi.fn();
  persistClaudeRequestTemplate = vi.fn();
  loadClaudeRequestTemplate = vi.fn();
  publishUsageLog = vi.fn(() => ({ model: 'MiniMax-M2.5', tokens: { input: 43, output: 32 } }));
  publishFailureLog = vi.fn();
  redirectModel = vi.fn((model) => model);
  normalizeGatewaySourceType = vi.fn((value, fallback = 'claude') => value || fallback);
  ensureOpenAiStreamUsage = vi.fn((body) => {
    if (body && typeof body === 'object') {
      body.stream_options = {
        ...(body.stream_options || {}),
        include_usage: true
      };
      return true;
    }
    return false;
  });

  return [
    ['../../../src/server/services/channel-scheduler', {
      allocateChannel,
      releaseChannel,
      getSchedulerState
    }],
    ['../../../src/server/services/channel-health', {
      recordSuccess,
      recordFailure
    }],
    ['../../../src/server/websocket-server', {
      broadcastLog,
      broadcastSchedulerState
    }],
    ['../../../src/config/loader', {
      loadConfig
    }],
    ['../../../src/config/default', {
      pricing: {
        claude: { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 }
      },
      ports: { proxy: proxyPort }
    }],
    ['../../../src/server/utils/pricing', {
      resolveModelPricing
    }],
    ['../../../src/server/services/statistics-service', {
      recordRequest
    }],
    ['../../../src/server/services/proxy-runtime', {
      saveProxyStartTime,
      clearProxyStartTime,
      getProxyStartTime,
      getProxyRuntime
    }],
    ['../../../src/server/services/response-decoder', {
      createDecodedStream
    }],
    ['../../../src/plugins/event-bus', eventBus],
    ['../../../src/server/services/channels', {
      getEffectiveApiKey,
      getAllChannels: vi.fn(() => [])
    }],
    ['../../../src/server/services/request-logger', {
      persistProxyRequestSnapshot,
      persistClaudeRequestTemplate,
      loadClaudeRequestTemplate
    }],
    ['../../../src/server/services/proxy-log-helper', {
      publishUsageLog,
      publishFailureLog
    }],
    ['../../../src/server/services/base/proxy-utils', {
      redirectModel,
      normalizeGatewaySourceType,
      ensureOpenAiStreamUsage
    }]
  ];
}

function resolvedStubs() {
  return createStubs().map(([mod, exports]) => [require.resolve(mod), exports]);
}

function injectStubs() {
  for (const [resolvedPath, exports] of resolvedStubs()) {
    require.cache[resolvedPath] = {
      id: resolvedPath,
      filename: resolvedPath,
      loaded: true,
      exports
    };
  }
}

function cleanStubs() {
  for (const [resolvedPath] of resolvedStubs()) {
    delete require.cache[resolvedPath];
  }
  delete require.cache[require.resolve(PROXY_SERVER_PATH)];
  delete require.cache[require.resolve(CLAUDE_OPENAI_GATEWAY_PATH)];
}

function createServer() {
  return http.createServer();
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

function postJson(port, pathName, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: buffer
        });
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

beforeEach(async () => {
  proxyPort = await getFreePort();
  proxyModule = null;
  upstreamServer = null;
  injectStubs();
  delete require.cache[require.resolve(PROXY_SERVER_PATH)];
});

afterEach(async () => {
  if (proxyModule?.getProxyStatus?.().running) {
    await proxyModule.stopProxyServer({ clearStartTime: false });
  }
  await closeServer(upstreamServer);
  cleanStubs();
});

describe('proxy-server exports', () => {
  it('exports startProxyServer', () => {
    const mod = require(PROXY_SERVER_PATH);
    expect(mod).toHaveProperty('startProxyServer');
  });

  it('exports stopProxyServer', () => {
    const mod = require(PROXY_SERVER_PATH);
    expect(mod).toHaveProperty('stopProxyServer');
  });

  it('exports getProxyStatus', () => {
    const mod = require(PROXY_SERVER_PATH);
    expect(mod).toHaveProperty('getProxyStatus');
  });

  it('exports clearRedirectCache', () => {
    const mod = require(PROXY_SERVER_PATH);
    expect(mod).toHaveProperty('clearRedirectCache');
  });

  it('all four exports are functions', () => {
    const { startProxyServer, stopProxyServer, getProxyStatus, clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(typeof startProxyServer).toBe('function');
    expect(typeof stopProxyServer).toBe('function');
    expect(typeof getProxyStatus).toBe('function');
    expect(typeof clearRedirectCache).toBe('function');
  });
});

describe('getProxyStatus', () => {
  it('returns an object with a running field when server has not been started', () => {
    const { getProxyStatus } = require(PROXY_SERVER_PATH);
    const status = getProxyStatus();
    expect(status).not.toBeNull();
    expect(typeof status).toBe('object');
    expect(status).toHaveProperty('running');
  });

  it('running is false when server has not been started', () => {
    const { getProxyStatus } = require(PROXY_SERVER_PATH);
    const status = getProxyStatus();
    expect(status.running).toBe(false);
  });
});

describe('clearRedirectCache', () => {
  it('does not throw when called with a channel id string', () => {
    const { clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(() => clearRedirectCache('ch1')).not.toThrow();
  });

  it('does not throw when called with null', () => {
    const { clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(() => clearRedirectCache(null)).not.toThrow();
  });

  it('does not throw when called with undefined', () => {
    const { clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(() => clearRedirectCache(undefined)).not.toThrow();
  });

  it('does not throw when called with no arguments', () => {
    const { clearRedirectCache } = require(PROXY_SERVER_PATH);
    expect(() => clearRedirectCache()).not.toThrow();
  });
});

describe('startProxyServer', () => {
  it('parses non-stream Anthropic JSON usage and publishes realtime usage logs', async () => {
    upstreamServer = http.createServer((req, res) => {
      let requestBody = '';
      req.on('data', (chunk) => {
        requestBody += chunk.toString('utf8');
      });
      req.on('end', () => {
        const parsedBody = JSON.parse(requestBody);
        expect(parsedBody.model).toBe('glm-5-local');

        res.writeHead(200, {
          'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({
          id: 'msg_minimax',
          type: 'message',
          model: 'MiniMax-M2.5',
          usage: {
            input_tokens: 43,
            output_tokens: 32,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        }));
      });
    });
    await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));

    allocateChannel.mockResolvedValue({
      id: 'channel-minimax',
      name: 'MiniMax Claude',
      baseUrl: `http://127.0.0.1:${upstreamServer.address().port}`
    });

    proxyModule = require(PROXY_SERVER_PATH);
    await proxyModule.startProxyServer();

    const response = await postJson(proxyPort, '/v1/messages', {
      model: 'glm-5-local',
      stream: false,
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: pong'
        }
      ]
    });

    expect(response.statusCode).toBe(200);
    expect(publishFailureLog).not.toHaveBeenCalled();
    expect(publishUsageLog).toHaveBeenCalledWith(expect.objectContaining({
      source: 'claude',
      metadata: expect.objectContaining({
        channel: 'MiniMax Claude',
        channelId: 'channel-minimax',
        requestModel: 'glm-5-local'
      }),
      model: 'MiniMax-M2.5',
      tokens: expect.objectContaining({
        input: 43,
        output: 32,
        cacheCreation: 0,
        cacheRead: 0,
        cached: 0,
        reasoning: 0,
        total: 0
      })
    }));
  });

  it('recovers complete tokens for Anthropic streams that only expose message_start usage', async () => {
    upstreamServer = http.createServer((req, res) => {
      let requestBody = '';
      req.on('data', (chunk) => {
        requestBody += chunk.toString('utf8');
      });
      req.on('end', () => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        const parsedBody = JSON.parse(requestBody);

        if (pathname === '/v1/messages/count_tokens') {
          res.writeHead(200, {
            'Content-Type': 'application/json'
          });

          if (parsedBody.messages.length === 1) {
            res.end(JSON.stringify({ input_tokens: 43 }));
            return;
          }

          expect(parsedBody.messages[1]).toEqual({
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'pong'
              }
            ]
          });
          res.end(JSON.stringify({ input_tokens: 75 }));
          return;
        }

        expect(pathname).toBe('/v1/messages');
        expect(parsedBody.model).toBe('glm-5-local');

        res.writeHead(200, {
          'Content-Type': 'text/event-stream'
        });
        res.write('event: message_start\n');
        res.write(`data: ${JSON.stringify({
          type: 'message_start',
          message: {
            type: 'message',
            model: 'MiniMax-M2.5',
            usage: {
              input_tokens: 8,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0
            },
            role: 'assistant',
            id: 'msg-stream',
            content: []
          }
        })}\n\n`);
        res.write('event: content_block_start\n');
        res.write(`data: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'text',
            text: ''
          }
        })}\n\n`);
        res.write('event: content_block_delta\n');
        res.write(`data: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: 'pong'
          }
        })}\n\n`);
        res.write('event: content_block_stop\n');
        res.write(`data: ${JSON.stringify({
          type: 'content_block_stop',
          index: 0
        })}\n\n`);
        res.write('event: message_stop\n');
        res.write(`data: ${JSON.stringify({
          type: 'message_stop'
        })}\n\n`);
        res.end();
      });
    });
    await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));

    allocateChannel.mockResolvedValue({
      id: 'channel-glm-stream',
      name: 'GLM Claude Stream',
      baseUrl: `http://127.0.0.1:${upstreamServer.address().port}`
    });

    proxyModule = require(PROXY_SERVER_PATH);
    await proxyModule.startProxyServer();

    const response = await postJson(proxyPort, '/v1/messages', {
      model: 'glm-5-local',
      stream: true,
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: pong'
        }
      ]
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('message_start');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(publishUsageLog).toHaveBeenCalledWith(expect.objectContaining({
      source: 'claude',
      metadata: expect.objectContaining({
        channel: 'GLM Claude Stream',
        channelId: 'channel-glm-stream',
        requestModel: 'glm-5-local'
      }),
      model: 'MiniMax-M2.5',
      tokens: expect.objectContaining({
        input: 43,
        output: 32,
        cacheCreation: 0,
        cacheRead: 0,
        cached: 0,
        reasoning: 0,
        total: 0
      })
    }));
  });

  it('uses chat completions for non-official OpenAI-compatible Claude routes so reply and cache tokens survive', async () => {
    upstreamServer = http.createServer((req, res) => {
      let requestBody = '';
      req.on('data', (chunk) => {
        requestBody += chunk.toString('utf8');
      });
      req.on('end', () => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        const parsedBody = JSON.parse(requestBody);

        expect(pathname).toBe('/v1/chat/completions');
        expect(parsedBody.model).toBe('claude-sonnet-4-6');
        expect(parsedBody.messages[0].content).toBe('Reply with exactly: pong');

        res.writeHead(200, {
          'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({
          id: 'chatcmpl_openai_non_stream',
          object: 'chat.completion',
          created: 1777089600,
          model: 'MiniMax-M2.5',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'pong'
              },
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: 43,
            completion_tokens: 32,
            total_tokens: 75,
            prompt_tokens_details: {
              cached_tokens: 16
            }
          }
        }));
      });
    });
    await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));

    allocateChannel.mockResolvedValue({
      id: 'channel-openai',
      name: 'OpenAI Claude Gateway',
      baseUrl: `http://127.0.0.1:${upstreamServer.address().port}/v1`,
      gatewaySourceType: 'openai_compatible',
      targetApi: 'responses'
    });

    proxyModule = require(PROXY_SERVER_PATH);
    await proxyModule.startProxyServer();

    const response = await postJson(proxyPort, '/v1/messages', {
      model: 'claude-sonnet-4-6',
      stream: false,
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: pong'
        }
      ]
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      id: 'chatcmpl_openai_non_stream',
      type: 'message',
      role: 'assistant',
      model: 'MiniMax-M2.5',
      content: [
        {
          type: 'text',
          text: 'pong'
        }
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 27,
        output_tokens: 32,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 16
      }
    });
    expect(publishUsageLog).toHaveBeenCalledWith(expect.objectContaining({
      source: 'claude',
      metadata: expect.objectContaining({
        channel: 'OpenAI Claude Gateway',
        channelId: 'channel-openai',
        requestModel: 'claude-sonnet-4-6'
      }),
      model: 'MiniMax-M2.5',
      tokens: expect.objectContaining({
        input: 27,
        output: 32,
        cacheRead: 16,
        cached: 16
      })
    }));
  });

  it('streams chat completion tool calls back as Claude SSE events and records full usage', async () => {
    upstreamServer = http.createServer((req, res) => {
      let requestBody = '';
      req.on('data', (chunk) => {
        requestBody += chunk.toString('utf8');
      });
      req.on('end', () => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        const parsedBody = JSON.parse(requestBody);

        expect(pathname).toBe('/v1/chat/completions');
        expect(parsedBody.stream).toBe(true);
        expect(parsedBody.stream_options).toEqual({ include_usage: true });

        res.writeHead(200, {
          'Content-Type': 'text/event-stream'
        });
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl_openai_stream',
          object: 'chat.completion.chunk',
          created: 1777089601,
          model: 'MiniMax-M2.5',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'Task',
                      arguments: ''
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl_openai_stream',
          object: 'chat.completion.chunk',
          created: 1777089601,
          model: 'MiniMax-M2.5',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '{\"description\":\"ping\"}'
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl_openai_stream',
          object: 'chat.completion.chunk',
          created: 1777089601,
          model: 'MiniMax-M2.5',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'tool_calls'
            }
          ]
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl_openai_stream',
          object: 'chat.completion.chunk',
          created: 1777089601,
          model: 'MiniMax-M2.5',
          choices: [],
          usage: {
            prompt_tokens: 14,
            completion_tokens: 5,
            total_tokens: 19,
            prompt_tokens_details: {
              cached_tokens: 4
            }
          }
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));

    allocateChannel.mockResolvedValue({
      id: 'channel-openai-stream',
      name: 'OpenAI Claude Stream',
      baseUrl: `http://127.0.0.1:${upstreamServer.address().port}/v1`,
      gatewaySourceType: 'openai_compatible',
      targetApi: 'responses'
    });

    proxyModule = require(PROXY_SERVER_PATH);
    await proxyModule.startProxyServer();

    const response = await postJson(proxyPort, '/v1/messages', {
      model: 'claude-sonnet-4-6',
      stream: true,
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: 'Use Task to say ping'
        }
      ]
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: message_start');
    expect(response.body).toContain('"type":"tool_use"');
    expect(response.body).toContain('"partial_json":"{\\"description\\":\\"ping\\"}"');
    expect(response.body).toContain('event: message_stop');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(publishUsageLog).toHaveBeenCalledWith(expect.objectContaining({
      source: 'claude',
      metadata: expect.objectContaining({
        channel: 'OpenAI Claude Stream',
        channelId: 'channel-openai-stream',
        requestModel: 'claude-sonnet-4-6'
      }),
      model: 'MiniMax-M2.5',
      tokens: expect.objectContaining({
        input: 10,
        output: 5,
        cacheRead: 4,
        cached: 4
      })
    }));
  });
});
