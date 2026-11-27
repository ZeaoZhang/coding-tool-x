'use strict';

/**
 * proxy-failover.js - 单次渠道故障转移
 *
 * http-proxy 在 `proxyRes` 阶段默认立即 writeHead + pipe，429/5xx 没有重试窗口。
 * 本模块用 `selfHandleResponse: true` 接管响应写出，在还没写下游响应头时对
 * 可重试状态码/连接错误换下一个渠道并重放请求体。
 */

const { downstreamHeaders } = require('./proxy-transport');
const {
  MODEL_UNAVAILABLE_STATUSES,
  channelDeclaresModel,
  isModelUnavailableResponse
} = require('./model-fallback');

const LOG_PREFIX = '[ProxyFailover]';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE'
]);

function isRetryableStatus(status) {
  return RETRYABLE_STATUS_CODES.has(Number(status));
}

function isRetryableError(error) {
  return Boolean(error && RETRYABLE_ERROR_CODES.has(error.code));
}

function cloneBody(value) {
  if (value === undefined || value === null) return null;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value !== 'object') return value;
  return structuredClone(value);
}

function defaultReadModel(req) {
  const body = req && req.body;
  return body && typeof body === 'object' && !Array.isArray(body) ? String(body.model || '') : '';
}

function defaultWriteModel(req, model) {
  const body = req && req.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    body.model = model;
    req.rawBody = null;
  }
}

function defaultCaptureRequest(req) {
  return { body: cloneBody(req.body), url: req.url };
}

function defaultRestoreRequest(req, snapshot) {
  req.url = snapshot.url;
  if (snapshot.body === null) return;
  req.body = cloneBody(snapshot.body);
  req.rawBody = null;
}

// http-proxy 只有在请求处于转发中时才会触发 proxyReq。没有活动尝试说明请求
// 已结算，此时按旧行为直接从请求上取已解析的报文，避免重复读取已消费的流。
function legacyRequestBody(req) {
  const contentType = String(req.headers?.['content-type'] || '');
  if (req.method !== 'POST' || !contentType.includes('application/json')) return null;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (req.rawBody) return Buffer.from(req.rawBody);
  if (req.body) return Buffer.from(JSON.stringify(req.body));
  return null;
}

function inspectBody(stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };
    const finish = (truncated) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ buffer: Buffer.concat(chunks), truncated });
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      // 超出嗅探上限：暂停流，已读部分交给调用方先写下去，余量再 pipe
      if (size > limit) {
        stream.pause();
        finish(true);
      }
    };
    const onEnd = () => finish(false);
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

function createFailoverProxy(options = {}) {
  const {
    source = 'proxy',
    maxAttempts = 2,
    proxyOptions = {},
    canRetry = () => true,
    allocate,
    release = () => {},
    captureRequest = defaultCaptureRequest,
    restoreRequest = defaultRestoreRequest,
    prepareAttempt,
    readModel = defaultReadModel,
    writeModel = defaultWriteModel,
    resolveModelFallbackTargets = () => [],
    maxModelFallbacks = 3,
    modelBodyLimit = 64 * 1024,
    onProxyReq = () => {},
    onFinalResponse = () => {},
    onRetry = () => {},
    writeError
  } = options;

  if (typeof allocate !== 'function') throw new TypeError('createFailoverProxy requires allocate()');
  if (typeof prepareAttempt !== 'function') throw new TypeError('createFailoverProxy requires prepareAttempt()');
  if (typeof writeError !== 'function') throw new TypeError('createFailoverProxy requires writeError()');

  // 惰性解析 createProxyServer，测试可以替换 `http-proxy` 模块。
  const createProxyServer = typeof options.createProxyServer === 'function'
    ? options.createProxyServer
    : serverOptions => require('http-proxy').createProxyServer(serverOptions);

  const proxy = createProxyServer({ ...proxyOptions, selfHandleResponse: true });

  proxy.on('proxyReq', (proxyReq, req, res) => {
    const attempt = req && req.__failoverAttempt;
    if (attempt && attempt.settled) {
      if (typeof proxyReq.destroy === 'function') proxyReq.destroy();
      return;
    }
    const channel = attempt?.channel || req?.selectedChannel || null;
    onProxyReq(proxyReq, req, res, channel);
    const body = attempt ? attempt.body : legacyRequestBody(req);
    if (Buffer.isBuffer(body)) {
      proxyReq.setHeader('content-length', body.length);
      proxyReq.write(body);
      proxyReq.end();
    }
  });

  proxy.on('proxyRes', (proxyRes, req, res) => {
    const attempt = req && req.__failoverAttempt;
    if (!attempt || attempt.settled) {
      proxyRes.destroy();
      return;
    }

    const statusCode = Number(proxyRes.statusCode) || 0;

    const pipeResponse = () => {
      onFinalResponse(proxyRes, req, res, attempt.channel);
      if (res.headersSent) {
        proxyRes.destroy();
        attempt.settle({ done: true });
        return;
      }
      res.writeHead(proxyRes.statusCode || 502, downstreamHeaders(proxyRes.headers));
      let completed = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        attempt.settle({ done: true });
        if (!proxyRes.destroyed) proxyRes.destroy();
      };
      proxyRes.once('end', finish);
      proxyRes.once('error', finish);
      res.once('close', finish);
      proxyRes.pipe(res);
    };

    try {
      // 400/404/422 + 体积可读：先读错误体判断"模型不可用"，是则换到配置的目标渠道+模型。
      // 无 content-length 或体积超限时不嗅探（避免破坏流式转发）。
      const declaredLength = Number(proxyRes.headers['content-length']);
      const canInspect = !Number.isFinite(declaredLength) || declaredLength <= modelBodyLimit;
      if (MODEL_UNAVAILABLE_STATUSES.has(statusCode)
        && !res.headersSent
        && canInspect
        && typeof attempt.takeModelFallback === 'function') {
        inspectBody(proxyRes, modelBodyLimit).then(({ buffer, truncated }) => {
          if (attempt.settled) {
            proxyRes.destroy();
            return;
          }
          if (!truncated && isModelUnavailableResponse(statusCode, buffer.toString('utf8'))) {
            const target = attempt.takeModelFallback();
            if (target) {
              proxyRes.destroy();
              attempt.settle({ modelFallback: target, statusCode });
              return;
            }
          }
          onFinalResponse(proxyRes, req, res, attempt.channel);
          if (res.headersSent) {
            attempt.settle({ done: true });
            return;
          }
          res.writeHead(statusCode, downstreamHeaders(proxyRes.headers));
          res.write(buffer);
          if (!truncated) {
            res.end();
            attempt.settle({ done: true });
            return;
          }
          // 超限：已读部分写下去，余量继续转发
          let completed = false;
          const finish = () => {
            if (completed) return;
            completed = true;
            attempt.settle({ done: true });
            if (!proxyRes.destroyed) proxyRes.destroy();
          };
          proxyRes.once('end', finish);
          proxyRes.once('error', finish);
          res.once('close', finish);
          proxyRes.pipe(res);
        }).catch((error) => {
          console.error(`${LOG_PREFIX} ${source} failed to inspect upstream error body:`, error);
          if (!proxyRes.destroyed) proxyRes.destroy();
          attempt.settle({ done: true });
        });
        return;
      }

      if (isRetryableStatus(statusCode)
        && !res.headersSent
        && typeof attempt.canChannelRetry === 'function'
        && attempt.canChannelRetry()) {
        proxyRes.destroy();
        attempt.settle({ retry: true, statusCode });
        return;
      }

      pipeResponse();
    } catch (error) {
      console.error(`${LOG_PREFIX} ${source} failed to forward response:`, error);
      if (!proxyRes.destroyed) proxyRes.destroy();
      attempt.settle({ done: true });
    }
  });

  proxy.on('error', (error, req) => {
    const attempt = req && req.__failoverAttempt;
    if (attempt) attempt.settle({ error });
  });

  async function runAttempt(req, res, channel, prepared, index, hooks = {}) {
    return new Promise((resolve) => {
      const attempt = {
        index,
        channel,
        body: null,
        settled: false,
        settle: null,
        canChannelRetry: hooks.canChannelRetry || (() => false),
        takeModelFallback: hooks.takeModelFallback || null
      };
      const body = Buffer.isBuffer(prepared.body) ? prepared.body : null;
      attempt.body = body;
      let settled = false;
      const teardown = [];

      const settle = (outcome) => {
        if (settled) return;
        settled = true;
        attempt.settled = true;
        attempt.body = null;
        for (const off of teardown) off();
        if (req.__failoverAttempt === attempt) req.__failoverAttempt = null;
        resolve(outcome || { done: true });
      };
      attempt.settle = settle;
      req.__failoverAttempt = attempt;

      const onClose = () => settle({ done: true });
      res.once('close', onClose);
      teardown.push(() => res.removeListener('close', onClose));

      try {
        proxy.web(req, res, {
          ...proxyOptions,
          ...(prepared.proxyOptions || {}),
          target: prepared.target
        }, error => settle(error ? { error } : { done: true }));
      } catch (error) {
        settle({ error });
      }
    });
  }

  async function handle(req, res) {
    const snapshot = captureRequest(req) || defaultCaptureRequest(req);
    const model = String(readModel(req) || '').trim();
    const channelRetryBudget = canRetry(req) ? Math.max(0, (Number(maxAttempts) || 1) - 1) : 0;
    const fallbackBudget = Math.max(0, Number(maxModelFallbacks) || 0);
    const attemptCap = Math.max(1, 1 + channelRetryBudget + fallbackBudget);
    const attempted = [];
    let channelRetries = 0;
    let lastError = null;
    let fallbackTargets = null;
    let fallbackIndex = 0;
    let pendingTarget = null;

    const fail = (statusCode, error, channel) => {
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      writeError(res, statusCode, error, channel);
    };

    // 目标列表只从"规则所在的渠道"读一次（配置写在正在使用该模型的那个渠道上）
    const nextModelTarget = (channel) => {
      if (!channel || !model) return null;
      if (fallbackTargets === null) {
        fallbackTargets = (resolveModelFallbackTargets(channel, model) || [])
          .filter(target => target && target.channelId && target.model)
          .map(target => ({ channelId: target.channelId, model: target.model }))
          .filter(target => target.channelId !== channel.id)
          .slice(0, fallbackBudget);
      }
      while (fallbackIndex < fallbackTargets.length) {
        const candidate = fallbackTargets[fallbackIndex++];
        if (!attempted.includes(candidate.channelId)) return candidate;
      }
      return null;
    };

    const logRetry = (channel, index, detail) => {
      const reason = detail.statusCode
        || (detail.error && detail.error.code)
        || (detail.error && detail.error.message)
        || 'unknown';
      console.log(`${LOG_PREFIX} ${source} ${channel.id} attempt ${index} -> retry (${reason})`);
      onRetry({ req, res, channel, attempt: index, ...detail });
    };

    for (let index = 0; index < attemptCap; index++) {
      restoreRequest(req, snapshot);

      const preferredChannelId = pendingTarget ? pendingTarget.channelId : null;
      if (pendingTarget) {
        writeModel(req, pendingTarget.model);
        pendingTarget = null;
      }

      let channel;
      try {
        channel = await allocate({ req, res, excludeChannelIds: [...attempted], preferredChannelId, attempt: index });
      } catch (error) {
        lastError = error || new Error('Channel allocation failed');
        break;
      }
      if (!channel) {
        lastError = preferredChannelId
          ? new Error(`Fallback channel ${preferredChannelId} is unavailable`)
          : new Error('No compatible channel available');
        break;
      }

      attempted.push(channel.id);
      req.selectedChannel = channel;

      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        try {
          release(channel.id);
        } catch (error) {
          console.error(`${LOG_PREFIX} ${source} failed to release ${channel.id}:`, error);
        }
      };
      req.__releaseChannel = releaseOnce;

      // 客户端在分配渠道期间已断开：立即释放，不再探测密钥或转发。
      if (res.destroyed || res.writableEnded) {
        releaseOnce();
        return;
      }

      // 请求前判定：本渠道没声明这个模型 → 直接走配置的模型回退（跳过一次上游调用）
      if (!preferredChannelId && !channelDeclaresModel(channel, model)) {
        const target = nextModelTarget(channel);
        if (target) {
          releaseOnce();
          console.log(`${LOG_PREFIX} ${source} ${channel.id} attempt ${index} -> model fallback (${target.channelId} / ${target.model}) [model not declared]`);
          pendingTarget = target;
          continue;
        }
      }

      let prepared;
      try {
        prepared = await prepareAttempt(req, res, channel, releaseOnce);
      } catch (error) {
        releaseOnce();
        lastError = error;
        if (error && error.statusCode) {
          fail(error.statusCode, error, channel);
          return;
        }
        if (res.headersSent || res.writableEnded) return;
        logRetry(channel, index, { error });
        continue;
      }

      if (prepared && prepared.handled === true) return;

      const outcome = await runAttempt(req, res, channel, prepared || {}, index, {
        canChannelRetry: () => channelRetries < channelRetryBudget,
        takeModelFallback: () => nextModelTarget(channel)
      });

      if (outcome.modelFallback) {
        releaseOnce();
        pendingTarget = outcome.modelFallback;
        lastError = Object.assign(
          new Error(`Model "${model}" is unavailable on ${channel.id}`),
          { statusCode: outcome.statusCode }
        );
        console.log(`${LOG_PREFIX} ${source} ${channel.id} attempt ${index} -> model fallback (${pendingTarget.channelId} / ${pendingTarget.model}) [upstream ${outcome.statusCode}]`);
        continue;
      }

      if (outcome.retry) {
        releaseOnce();
        channelRetries += 1;
        lastError = Object.assign(new Error(`Upstream returned HTTP ${outcome.statusCode}`), {
          statusCode: outcome.statusCode
        });
        logRetry(channel, index, { statusCode: outcome.statusCode });
        continue;
      }

      if (outcome.error) {
        releaseOnce();
        lastError = outcome.error;
        if (isRetryableError(outcome.error) && channelRetries < channelRetryBudget && !res.headersSent) {
          channelRetries += 1;
          logRetry(channel, index, { error: outcome.error });
          continue;
        }
        // 终态失败：即使不再重试，也要让驱动记下这次渠道失败（旧实现在
        // proxy.web 回调里对每个错误都会记录）。
        onRetry({ req, res, channel, attempt: index, error: outcome.error });
        fail(502, outcome.error, channel);
        return;
      }

      releaseOnce();
      return;
    }

    const statusCode = (lastError && lastError.statusCode) || (attempted.length === 0 ? 503 : 502);
    fail(statusCode, lastError || new Error('No compatible channel'), null);
  }

  return { proxy, handle };
}

module.exports = {
  isRetryableStatus,
  isRetryableError,
  createFailoverProxy
};
