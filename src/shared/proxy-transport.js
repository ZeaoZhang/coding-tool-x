'use strict';

const ignoreStreamError = () => {};

// Connection headers describe one transport hop, not the downstream socket.
function downstreamHeaders(headers = {}) {
  const result = { ...headers };
  const connectionHeaders = String(headers.connection || '').split(',').map(name => name.trim().toLowerCase());
  for (const name of ['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate',
    'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...connectionHeaders]) {
    delete result[name];
  }
  return result;
}

function collectResponseBody(response, stream = response, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', fail);
      response.removeListener('error', fail);
      response.removeListener('aborted', onAborted);
      stream.removeListener('close', onClosed);
      response.removeListener('close', onResponseClosed);
      chunks.length = 0;
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      // A native abort may emit aborted first and an error afterwards.
      stream.once('error', ignoreStreamError);
      if (response !== stream) response.once('error', ignoreStreamError);
      reject(error);
    };
    const onData = (value) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail(new Error('Gateway response exceeds its byte limit'));
        stream.destroy();
        if (response !== stream) response.destroy();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks, bytes).toString('utf8');
      cleanup();
      resolve(body);
    };
    const onAborted = () => fail(new Error('Gateway response aborted'));
    const onClosed = () => fail(new Error('Gateway response closed before completion'));
    const onResponseClosed = () => {
      if (!response.complete && !response.readableEnded) onClosed();
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', fail);
    if (response !== stream) response.once('error', fail);
    response.once('aborted', onAborted);
    stream.once('close', onClosed);
    if (response !== stream) response.once('close', onResponseClosed);
  });
}

function proxyRequestLifecycle(req, res, next) {
  const controller = new AbortController();
  req.proxyAllocationSignal = controller.signal;
  const abort = () => controller.abort();
  const finish = () => {
    if (!res.writableEnded) abort();
    req.removeListener('aborted', abort);
    res.removeListener('finish', finish);
    res.removeListener('close', finish);
    res.removeListener('error', finish);
    req.rawBody = null;
    req.body = undefined;
  };
  req.once('aborted', abort);
  res.once('finish', finish);
  res.once('close', finish);
  res.once('error', finish);
  if (req.aborted || res.destroyed) abort();
  next();
}

function bindChannelRelease(req, res, release) {
  const finish = () => {
    res.removeListener('finish', finish);
    res.removeListener('close', finish);
    res.removeListener('error', finish);
    release();
  };
  res.once('finish', finish);
  res.once('close', finish);
  res.once('error', finish);
  if (res.destroyed || res.writableEnded) finish();
}

function bindProxyRequest(proxyReq, res) {
  if (!res) return;
  const abort = () => {
    if (!res.writableEnded && typeof proxyReq.destroy === 'function') proxyReq.destroy();
  };
  res.once('close', abort);
  proxyReq.once('close', () => res.removeListener('close', abort));
  if (res.destroyed) abort();
}

function prepareProxyResponse(proxyRes, res) {
  proxyRes.headers = downstreamHeaders(proxyRes.headers);
  const fail = error => {
    if (res && !res.destroyed) res.destroy(error);
  };
  proxyRes.once('error', fail);
  proxyRes.once('aborted', () => fail(new Error('Upstream response aborted')));
}

module.exports = { downstreamHeaders, bindProxyRequest, prepareProxyResponse, proxyRequestLifecycle, bindChannelRelease, collectResponseBody };
