'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');
const { URL } = require('url');
const { allocateChannel, releaseChannel } = require('../../../server/services/channel-scheduler');
const { recordSuccess, recordFailure } = require('../../../server/services/channel-health');
const { recordRequest: recordOmpRequest } = require('./statistics-implementation');
const {
  createTokenData,
  mergeUsageIntoTokenData,
  parseNonStreamingUsage,
  parseSSEEventText,
  parseSSEUsage,
  splitSSEEvents
} = require('../../../server/services/base/response-usage-parser');
const {
  publishFailureLog: publishSharedFailureLog,
  publishUsageLog: publishSharedUsageLog
} = require('../../../server/services/proxy-log-helper');
const { attachServerShutdownHandling, expediteServerShutdown } = require('../../../server/services/server-shutdown');
const { resolveOmpGatewayRoute } = require('./gateway-routing');
const { broadcastLog } = require('../../../server/websocket-server');

const RETRYABLE_STATUS = new Set([401, 403, 429, 502, 503, 504]);
const MAX_REQUEST_BYTES = 100 * 1024 * 1024;

function createAbortError(message = 'OMP downstream client disconnected') {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

function normalizeHeaderMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function collectChannelHeaders(channel = {}) {
  return {
    ...normalizeHeaderMap(channel.providerConfig?.headers),
    ...normalizeHeaderMap(channel.headers)
  };
}

function buildUpstreamRequestPath(baseUrl, requestUrl) {
  const base = new URL(baseUrl);
  const request = new URL(requestUrl, 'http://127.0.0.1');
  const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '');
  const requestedPath = request.pathname || '/';
  const pathAlreadyIncludesBase = basePath
    && (requestedPath === basePath || requestedPath.startsWith(`${basePath}/`));
  const pathname = pathAlreadyIncludesBase
    ? requestedPath
    : `${basePath}/${requestedPath.replace(/^\/+/, '')}` || '/';
  const search = new URLSearchParams(base.searchParams);
  request.searchParams.forEach((value, name) => search.set(name, value));
  const query = search.toString();
  return `${pathname.startsWith('/') ? pathname : `/${pathname}`}${query ? `?${query}` : ''}`;
}

function rewriteCodexResponsesRequestPath(baseUrl, requestUrl, providerApi = '') {
  if (providerApi !== 'openai-codex-responses') return buildUpstreamRequestPath(baseUrl, requestUrl);

  const base = new URL(baseUrl);
  const request = new URL(requestUrl, 'http://127.0.0.1');
  const requestedPath = request.pathname.replace(/\/+$/, '') || '/';
  if (!requestedPath.endsWith('/codex/responses')) {
    return buildUpstreamRequestPath(baseUrl, requestUrl);
  }

  const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '');
  let pathname;
  if (!basePath) {
    pathname = '/codex/responses';
  } else if (basePath.endsWith('/responses')) {
    pathname = basePath;
  } else if (basePath.endsWith('/v1') || basePath.endsWith('/codex')) {
    pathname = `${basePath}/responses`;
  } else {
    pathname = `${basePath}/codex/responses`;
  }

  const search = new URLSearchParams(base.searchParams);
  request.searchParams.forEach((value, name) => search.set(name, value));
  const query = search.toString();
  return `${pathname.startsWith('/') ? pathname : `/${pathname}`}${query ? `?${query}` : ''}`;
}

function rewriteCredential(headers, requestUrl, route, channel, options = {}) {
  const next = { ...headers };
  delete next.host;
  delete next['content-length'];
  delete next['accept-encoding'];
  if (!options.preserveConnection) {
    delete next.connection;
  }

  const authHeaders = ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key'];
  const upstreamKey = String(channel.apiKey || '');
  for (const name of authHeaders) {
    delete next[name];
  }

  const url = new URL(requestUrl, 'http://127.0.0.1');
  for (const name of ['key', 'api_key', 'access_token', 'token']) {
    url.searchParams.delete(name);
  }

  if (channel.authMode !== 'none' && upstreamKey) {
    if (route.authMode === 'oauth') {
      next.authorization = `Bearer ${upstreamKey}`;
    } else if (route.providerApi === 'anthropic-messages') {
      next['x-api-key'] = upstreamKey;
    } else if (route.providerApi === 'azure-openai-responses') {
      next['api-key'] = upstreamKey;
    } else if (route.providerApi.startsWith('google-')) {
      next['x-goog-api-key'] = upstreamKey;
    } else {
      next.authorization = `Bearer ${upstreamKey}`;
    }
  }

  Object.entries(collectChannelHeaders(channel)).forEach(([name, value]) => {
    next[String(name).toLowerCase()] = String(value);
  });
  return { headers: next, path: `${url.pathname}${url.search}` };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        fail(Object.assign(new Error('OMP gateway request body is too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('Client aborted request')));
  });
}

function extractModelId(body, contentType = '') {
  if (!body?.length || !String(contentType).includes('json')) return '';
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (typeof parsed.model === 'string') return parsed.model.trim();
    if (parsed.model && typeof parsed.model === 'object') {
      return String(parsed.model.id || parsed.model.name || '').trim();
    }
    return String(parsed.modelId || parsed.model_id || '').trim();
  } catch {
    return '';
  }
}

function normalizeModelId(value) {
  return String(value || '').trim().replace(/:(minimal|low|medium|high|xhigh|off)$/, '');
}

function channelSupportsModel(channel, modelId) {
  const requested = normalizeModelId(modelId).toLowerCase();
  if (!requested) return true;
  const declared = [];
  (Array.isArray(channel.allowedModels) ? channel.allowedModels : []).forEach(value => declared.push(value));
  (Array.isArray(channel.models) ? channel.models : []).forEach((model) => {
    declared.push(typeof model === 'string' ? model : (model?.id || model?.name));
  });
  if (channel.model) declared.push(channel.model);
  const normalized = [...new Set(declared.map(normalizeModelId).filter(Boolean).map(value => value.toLowerCase()))];
  return normalized.length === 0 || normalized.includes(requested);
}

function writeJson(res, statusCode, payload) {
  if (res.headersSent || res.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length
  });
  res.end(body);
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidCapability(req, parsedUrl, route) {
  if (route.authMode === 'none') return true;
  const candidates = [
    req.headers.authorization,
    req.headers['x-api-key'],
    req.headers['x-goog-api-key'],
    req.headers['api-key'],
    parsedUrl.searchParams.get('key'),
    parsedUrl.searchParams.get('api_key'),
    parsedUrl.searchParams.get('access_token'),
    parsedUrl.searchParams.get('token')
  ].flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(value => value !== undefined && value !== null)
    .map((value) => String(value).replace(/^Bearer\s+/i, '').trim());
  return candidates.some(candidate => constantTimeEqual(candidate, route.capability));
}

function mergeParsedUsage(tokenData, value, eventType = '') {
  if (Array.isArray(value)) {
    value.forEach(item => mergeParsedUsage(tokenData, item, eventType));
    return;
  }
  mergeUsageIntoTokenData(
    tokenData,
    eventType ? parseSSEUsage(value, eventType) : parseNonStreamingUsage(value)
  );
}

function createResponseUsageMonitor(contentType = '') {
  const tokenData = createTokenData();
  const streaming = String(contentType).toLowerCase().includes('text/event-stream');
  const chunks = [];
  let bufferedBytes = 0;
  let sseBuffer = '';
  let observationDisabled = false;

  const parseEvent = (eventText) => {
    const event = parseSSEEventText(eventText);
    if (!event) return;
    try {
      mergeParsedUsage(tokenData, JSON.parse(event.data), event.eventType);
    } catch {
      // Usage observation must never alter or reject the transparent response.
    }
  };

  return {
    observe(chunk) {
      if (observationDisabled) return;
      if (streaming) {
        if (Buffer.byteLength(sseBuffer) + chunk.length > MAX_REQUEST_BYTES) {
          observationDisabled = true;
          sseBuffer = '';
          return;
        }
        sseBuffer += chunk.toString('utf8');
        const split = splitSSEEvents(sseBuffer);
        split.events.forEach(parseEvent);
        sseBuffer = split.remainder;
      } else if (bufferedBytes + chunk.length <= MAX_REQUEST_BYTES) {
        chunks.push(Buffer.from(chunk));
        bufferedBytes += chunk.length;
      } else {
        observationDisabled = true;
        chunks.length = 0;
      }
    },
    finish() {
      if (observationDisabled) {
        return {
          model: tokenData.model,
          tokens: {
            input: tokenData.inputTokens,
            output: tokenData.outputTokens,
            cacheCreation: tokenData.cacheCreation,
            cacheRead: tokenData.cacheRead,
            cached: tokenData.cachedTokens,
            reasoning: tokenData.reasoningTokens,
            total: tokenData.totalTokens
          }
        };
      }
      if (streaming) {
        parseEvent(sseBuffer);
      } else if (chunks.length > 0) {
        try {
          mergeParsedUsage(tokenData, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          // Non-JSON responses are valid passthrough responses without usage.
        }
      }
      return {
        model: tokenData.model,
        tokens: {
          input: tokenData.inputTokens,
          output: tokenData.outputTokens,
          cacheCreation: tokenData.cacheCreation,
          cacheRead: tokenData.cacheRead,
          cached: tokenData.cachedTokens,
          reasoning: tokenData.reasoningTokens,
          total: tokenData.totalTokens
        }
      };
    }
  };
}

function closeServer(server, forceAfterMs = 1000) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = expediteServerShutdown(server, { forceAfterMs });
    server.close((error) => {
      if (timer) clearTimeout(timer);
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function createOmpGateway(options = {}) {
  const getChannels = options.getChannels;
  const allocate = options.allocateChannel || allocateChannel;
  const release = options.releaseChannel || releaseChannel;
  const onSuccess = options.recordSuccess || recordSuccess;
  const onFailure = options.recordFailure || recordFailure;
  const publishUsage = options.publishUsageLog || ((data) => {
    const enrich = (payload) => broadcastLog({
      ...payload,
      originalProvider: data.originalProvider,
      providerApi: data.providerApi,
      routingGroup: data.routingGroup,
      actualChannelId: data.channelId,
      upstreamModel: data.model,
      switchReason: data.switchReason || undefined,
      attemptedChannels: data.attemptedChannels
    });
    return publishSharedUsageLog({
      source: 'omp',
      metadata: {
        id: data.requestId,
        channel: data.channel,
        channelId: data.channelId,
        originalModel: data.originalModel,
        startTime: data.startTime
      },
      model: data.model || data.originalModel,
      tokens: data.tokens,
      broadcastLog: enrich,
      recordRequest: recordOmpRequest,
      recordSuccess: null
    });
  });
  const publishFailure = options.publishFailureLog || ((data) => {
    const enrich = (payload) => broadcastLog({
      ...payload,
      originalProvider: data.originalProvider,
      providerApi: data.providerApi,
      routingGroup: data.routingGroup,
      actualChannelId: data.channelId,
      switchReason: data.switchReason || undefined,
      attemptedChannels: data.attemptedChannels
    });
    return publishSharedFailureLog({
      source: 'omp',
      metadata: {
        id: data.requestId,
        channel: data.channel,
        model: data.model
      },
      channel: data.channel,
      model: data.model,
      message: data.message,
      error: data.error,
      statusCode: data.statusCode,
      stage: data.stage,
      broadcastLog: enrich
    });
  });
  const websocketProxy = httpProxy.createProxyServer({
    ws: true,
    changeOrigin: true,
    xfwd: false
  });

  let server = null;
  let host = '127.0.0.1';
  let port = null;
  let secret = '';
  let draining = false;
  let inflightRequests = 0;
  const activeUpstreams = new Set();

  function gatewayDescriptor() {
    return { host, port, secret };
  }

  function currentChannels() {
    const value = typeof getChannels === 'function' ? getChannels() : [];
    return Array.isArray(value?.channels) ? value.channels : (Array.isArray(value) ? value : []);
  }

  async function allocateForRoute(route, excludedIds = [], modelId = '', signal = null) {
    const channels = currentChannels();
    const candidateIds = route.channelIds.filter((channelId) => {
      const channel = channels.find(item => item.id === channelId);
      return channel && channelSupportsModel(channel, modelId);
    });
    if (candidateIds.length === 0) {
      throw Object.assign(
        new Error(`No OMP channel in routing group "${route.routingGroup}" supports model "${modelId}"`),
        { statusCode: 422 }
      );
    }
    return allocate({
      source: 'omp',
      enableSessionBinding: false,
      candidateIds,
      excludeChannelIds: [...excludedIds],
      routingGroup: route.routingGroup,
      providerKey: route.providerKey,
      providerApi: route.providerApi,
      modelId: normalizeModelId(modelId),
      signal
    });
  }

  function forwardAttempt(req, route, channel, body, signal) {
    return new Promise((resolve, reject) => {
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        release(channel.id, 'omp');
      };
      if (signal?.aborted) {
        releaseOnce();
        reject(createAbortError());
        return;
      }

      let upstream;
      try {
        upstream = new URL(channel.baseUrl);
      } catch (error) {
        releaseOnce();
        reject(error);
        return;
      }

      const upstreamPath = rewriteCodexResponsesRequestPath(channel.baseUrl, route.upstreamPath, route.providerApi);
      const rewritten = rewriteCredential(req.headers, upstreamPath, route, channel);
      const transport = upstream.protocol === 'https:' ? https : http;
      let upstreamResponse = null;
      const upstreamRequest = transport.request({
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        method: req.method,
        path: rewritten.path,
        headers: {
          ...rewritten.headers,
          host: upstream.host,
          'content-length': body.length
        }
      }, (response) => {
        upstreamResponse = response;
        activeUpstreams.delete(upstreamRequest);
        activeUpstreams.add(response);
        response.once('close', () => {
          signal?.removeEventListener('abort', abortUpstream);
        });
        const statusCode = response.statusCode || 502;
        resolve({
          statusCode,
          response,
          channel,
          release: releaseOnce
        });
      });

      activeUpstreams.add(upstreamRequest);
      const abortUpstream = () => {
        const error = createAbortError();
        if (upstreamResponse) {
          upstreamResponse.destroy(error);
        } else {
          upstreamRequest.destroy(error);
        }
      };
      signal?.addEventListener('abort', abortUpstream, { once: true });
      upstreamRequest.on('error', (error) => {
        signal?.removeEventListener('abort', abortUpstream);
        activeUpstreams.delete(upstreamRequest);
        releaseOnce();
        reject(error);
      });
      upstreamRequest.end(body);
    });
  }

  async function handleProxyRequest(req, res, route, signal) {
    const body = await readRequestBody(req);
    if (signal?.aborted) throw createAbortError();
    const modelId = extractModelId(body, req.headers['content-type']);
    const attemptedIds = [];
    const attemptedChannels = [];
    const requestId = `omp-${crypto.randomUUID()}`;
    const startTime = Date.now();
    let lastError = null;
    let switchReason = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      let channel;
      try {
        channel = await allocateForRoute(route, attemptedIds, modelId, signal);
      } catch (error) {
        lastError = error;
        break;
      }
      if (signal?.aborted) {
        release(channel.id, 'omp');
        lastError = createAbortError();
        break;
      }
      attemptedIds.push(channel.id);
      attemptedChannels.push(channel.name || channel.id);

      try {
        const result = await forwardAttempt(req, route, channel, body, signal);
        if (attempt === 0 && RETRYABLE_STATUS.has(result.statusCode)) {
          result.response.once('close', () => activeUpstreams.delete(result.response));
          result.response.resume();
          result.release();
          onFailure(channel.id, 'omp');
          switchReason = `http-${result.statusCode}`;
          publishFailure({
            source: 'omp',
            requestId,
            channel: channel.name || channel.id,
            channelId: channel.id,
            originalProvider: route.providerKey,
            providerApi: route.providerApi,
            routingGroup: route.routingGroup,
            model: modelId,
            statusCode: result.statusCode,
            stage: 'dynamic-switch',
            switchReason,
            attemptedChannels: [...attemptedChannels],
            message: `OMP upstream returned HTTP ${result.statusCode}`
          });
          lastError = Object.assign(new Error(`OMP upstream returned HTTP ${result.statusCode}`), {
            statusCode: result.statusCode
          });
          continue;
        }

        res.writeHead(result.statusCode, result.response.headers);
        const usageMonitor = createResponseUsageMonitor(result.response.headers['content-type']);
        await new Promise((resolve) => {
          let completed = false;
          const finish = (error) => {
            if (completed) return;
            completed = true;
            activeUpstreams.delete(result.response);
            result.release();
            if (result.statusCode < 400 && !error) {
              const usage = usageMonitor.finish();
              onSuccess(channel.id, 'omp');
              publishUsage({
                source: 'omp',
                requestId,
                startTime,
                channel: channel.name || channel.id,
                channelId: channel.id,
                originalProvider: route.providerKey,
                providerApi: route.providerApi,
                routingGroup: route.routingGroup,
                originalModel: modelId,
                model: usage.model || modelId,
                tokens: usage.tokens,
                switchReason,
                attemptedChannels: [...attemptedChannels]
              });
            } else {
              onFailure(channel.id, 'omp');
              publishFailure({
                source: 'omp',
                requestId,
                channel: channel.name || channel.id,
                channelId: channel.id,
                originalProvider: route.providerKey,
                providerApi: route.providerApi,
                routingGroup: route.routingGroup,
                model: modelId,
                error,
                statusCode: result.statusCode,
                stage: error ? 'response-stream' : 'upstream-response',
                switchReason,
                attemptedChannels: [...attemptedChannels],
                message: error?.message || `OMP upstream returned HTTP ${result.statusCode}`
              });
            }
            resolve();
          };
          result.response.on('data', chunk => usageMonitor.observe(chunk));
          result.response.once('end', () => finish());
          result.response.once('close', () => finish(new Error('OMP upstream response closed early')));
          result.response.once('error', (error) => {
            if (!res.destroyed) res.destroy(error);
            finish(error);
          });
          res.once('close', () => {
            if (!res.writableEnded) {
              result.response.destroy(new Error('OMP downstream client disconnected'));
            }
          });
          result.response.pipe(res);
        });
        return;
      } catch (error) {
        lastError = error;
        if (error?.name === 'AbortError') {
          break;
        }
        onFailure(channel.id, 'omp');
        switchReason = error.code || error.message || 'connection-error';
        publishFailure({
          source: 'omp',
          requestId,
          channel: channel.name || channel.id,
          channelId: channel.id,
          originalProvider: route.providerKey,
          providerApi: route.providerApi,
          routingGroup: route.routingGroup,
          model: modelId,
          error,
          statusCode: error.statusCode,
          stage: attempt === 0 ? 'dynamic-switch' : 'upstream-connect',
          switchReason,
          attemptedChannels: [...attemptedChannels]
        });
      }
    }

    throw lastError || new Error('No compatible OMP channel is available');
  }

  async function handleRequest(req, res) {
    if (req.method === 'GET' && req.url === '/healthz') {
      writeJson(res, 200, {
        ok: true,
        service: 'omp-gateway',
        draining,
        inflightRequests
      });
      return;
    }
    if (draining) {
      writeJson(res, 503, { error: 'OMP gateway is draining' });
      return;
    }

    let parsed;
    try {
      parsed = new URL(req.url, `http://${host}`);
    } catch {
      writeJson(res, 400, { error: 'Invalid OMP gateway URL' });
      return;
    }
    let route;
    try {
      route = resolveOmpGatewayRoute(parsed.pathname, currentChannels(), gatewayDescriptor());
    } catch (error) {
      writeJson(res, 503, { error: error.message });
      return;
    }
    if (!route) {
      writeJson(res, 404, { error: 'Unknown OMP gateway route' });
      return;
    }
    if (!hasValidCapability(req, parsed, route)) {
      writeJson(res, 401, { error: 'Invalid OMP gateway capability' });
      return;
    }
    route.upstreamPath = `${route.upstreamPath}${parsed.search}`;

    inflightRequests++;
    const abortController = new AbortController();
    const abortDownstream = () => abortController.abort();
    const abortClosedResponse = () => {
      if (!res.writableEnded) abortDownstream();
    };
    req.once('aborted', abortDownstream);
    res.once('close', abortClosedResponse);
    try {
      await handleProxyRequest(req, res, route, abortController.signal);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        writeJson(res, error.statusCode || 502, { error: error.message || 'OMP upstream request failed' });
      }
    } finally {
      req.removeListener('aborted', abortDownstream);
      res.removeListener('close', abortClosedResponse);
      inflightRequests = Math.max(0, inflightRequests - 1);
    }
  }

  function rejectUpgrade(socket, statusCode, message) {
    if (!socket || socket.destroyed) return;
    const body = JSON.stringify({ error: message });
    const statusText = {
      401: 'Unauthorized',
      404: 'Not Found',
      503: 'Service Unavailable'
    }[statusCode] || 'Bad Gateway';
    socket.end([
      `HTTP/1.1 ${statusCode} ${statusText}`,
      'Content-Type: application/json; charset=utf-8',
      `Content-Length: ${Buffer.byteLength(body)}`,
      'Connection: close',
      '',
      body
    ].join('\r\n'));
  }

  async function handleUpgrade(req, socket, head) {
    if (draining) {
      rejectUpgrade(socket, 503, 'OMP gateway is draining');
      return;
    }
    let parsed;
    try {
      parsed = new URL(req.url, `http://${host}`);
    } catch {
      rejectUpgrade(socket, 404, 'Invalid OMP gateway URL');
      return;
    }
    let route;
    try {
      route = resolveOmpGatewayRoute(parsed.pathname, currentChannels(), gatewayDescriptor());
    } catch (error) {
      rejectUpgrade(socket, 503, error.message);
      return;
    }
    if (!route) {
      rejectUpgrade(socket, 404, 'Unknown OMP gateway route');
      return;
    }
    if (!hasValidCapability(req, parsed, route)) {
      rejectUpgrade(socket, 401, 'Invalid OMP gateway capability');
      return;
    }
    route.upstreamPath = `${route.upstreamPath}${parsed.search}`;

    let channel;
    try {
      channel = await allocateForRoute(route);
    } catch (error) {
      rejectUpgrade(socket, 503, error.message || 'No compatible OMP channel is available');
      return;
    }

    inflightRequests++;
    const requestId = `omp-${crypto.randomUUID()}`;
    const startTime = Date.now();
    const websocketModel = normalizeModelId(channel.model || '');
    let released = false;
    let failed = false;
    let failureRecorded = false;
    const markFailedOnce = (error) => {
      failed = true;
      if (failureRecorded) return;
      failureRecorded = true;
      onFailure(channel.id, 'omp');
      publishFailure({
        source: 'omp',
        requestId,
        channel: channel.name || channel.id,
        channelId: channel.id,
        originalProvider: route.providerKey,
        providerApi: route.providerApi,
        routingGroup: route.routingGroup,
        model: websocketModel,
        error,
        stage: 'websocket',
        attemptedChannels: [channel.name || channel.id]
      });
    };
    const releaseOnce = () => {
      if (released) return;
      released = true;
      inflightRequests = Math.max(0, inflightRequests - 1);
      if (!failed) {
        onSuccess(channel.id, 'omp');
        publishUsage({
          source: 'omp',
          requestId,
          startTime,
          channel: channel.name || channel.id,
          channelId: channel.id,
          originalProvider: route.providerKey,
          providerApi: route.providerApi,
          routingGroup: route.routingGroup,
          originalModel: websocketModel,
          model: websocketModel,
          tokens: {},
          attemptedChannels: [channel.name || channel.id]
        });
      }
      release(channel.id, 'omp');
    };
    socket.once('close', releaseOnce);
    socket.once('error', (error) => {
      markFailedOnce(error);
      releaseOnce();
    });

    try {
      const upstream = new URL(channel.baseUrl);
      const upstreamPath = buildUpstreamRequestPath(channel.baseUrl, route.upstreamPath);
      const rewritten = rewriteCredential(req.headers, upstreamPath, route, channel, {
        preserveConnection: true
      });
      req.url = rewritten.path;
      req.headers = {
        ...rewritten.headers,
        host: upstream.host
      };
      req.__ompGatewayRelease = releaseOnce;
      req.__ompGatewayFail = markFailedOnce;
      websocketProxy.ws(req, socket, head, {
        target: upstream.origin,
        changeOrigin: true,
        secure: upstream.protocol === 'https:'
      });
    } catch (error) {
      markFailedOnce(error);
      releaseOnce();
      rejectUpgrade(socket, 503, error.message || 'OMP websocket proxy failed');
    }
  }

  websocketProxy.on('error', (error, req, socket) => {
    req?.__ompGatewayFail?.(error);
    req?.__ompGatewayRelease?.();
    if (socket && !socket.destroyed) {
      socket.destroy(error);
    }
  });

  async function start(startOptions = {}) {
    if (server?.listening) return status();
    host = startOptions.host || '127.0.0.1';
    port = Number.isInteger(startOptions.port) ? startOptions.port : 20092;
    if (port < 0 || port > 65535) {
      throw new Error(`Invalid OMP gateway port: ${port}`);
    }
    secret = String(startOptions.secret || '');
    if (!secret) {
      throw new Error('OMP gateway secret is required');
    }
    draining = false;
    server = attachServerShutdownHandling(http.createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        writeJson(res, 500, { error: error.message || 'OMP gateway request failed' });
      });
    }));
    server.on('upgrade', (req, socket, head) => {
      handleUpgrade(req, socket, head).catch((error) => {
        rejectUpgrade(socket, 503, error.message || 'OMP websocket proxy failed');
      });
    });

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    } catch (error) {
      server = null;
      port = null;
      throw error;
    }
    port = server.address().port;
    return status();
  }

  async function stop(stopOptions = {}) {
    if (!server) return status();
    draining = true;
    await closeServer(server, stopOptions.forceAfterMs);
    activeUpstreams.clear();
    server = null;
    port = null;
    draining = false;
    inflightRequests = 0;
    return status();
  }

  function cancelDraining() {
    draining = false;
  }

  function beginDraining() {
    draining = true;
  }

  function status() {
    return {
      listening: Boolean(server?.listening),
      draining,
      port,
      inflightRequests
    };
  }

  return {
    start,
    stop,
    status,
    beginDraining,
    cancelDraining,
    descriptor: gatewayDescriptor
  };
}

module.exports = {
  createOmpGateway
};
