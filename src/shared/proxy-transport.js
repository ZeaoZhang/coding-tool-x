'use strict';

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

module.exports = { downstreamHeaders, bindProxyRequest, prepareProxyResponse };
