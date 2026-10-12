const SOCKET_TRACKER = Symbol('ccTool.socketTracker');
const { trackMemoryActivity } = require('./memory-reclaimer');
const proxyServers = new Set();
const PROXY_IDLE_TIMEOUT_MS = 10 * 60_000;

function attachServerShutdownHandling(server, options = {}) {
  if (!server || server[SOCKET_TRACKER]) {
    return server;
  }

  const sockets = new Set();
  // Proxy servers share the process with the UI; streaming requests must also
  // prevent idle memory collection until their response finishes or closes.
  server.prependListener('request', trackMemoryActivity);
  server.prependListener('upgrade', (req, socket) => trackMemoryActivity(req, socket));
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  const keepAliveTimeout = Number.isFinite(options.keepAliveTimeout)
    ? Math.max(0, options.keepAliveTimeout)
    : 5000;
  const headersTimeout = Number.isFinite(options.headersTimeout)
    ? Math.max(keepAliveTimeout + 1000, options.headersTimeout)
    : Math.max(60_000, keepAliveTimeout + 1000);

  server.keepAliveTimeout = keepAliveTimeout;
  server.headersTimeout = headersTimeout;
  server[SOCKET_TRACKER] = { sockets };
  if (options.drainOnExit !== false) {
    if (server.listening) proxyServers.add(server);
    else server.once('listening', () => proxyServers.add(server));
    server.once('close', () => proxyServers.delete(server));
  }
  return server;
}

async function drainProxyServers(options = {}) {
  await Promise.all([...proxyServers].map(server => new Promise((resolve, reject) => {
    const timer = expediteServerShutdown(server, { forceAfterMs: options.forceAfterMs ?? 120_000 });
    server.close(error => {
      if (timer) clearTimeout(timer);
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
  })));
}

function expediteServerShutdown(server, options = {}) {
  if (!server) {
    return null;
  }

  try {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
  } catch {
    // ignore idle-connection close failures
  }

  const delay = Number.isFinite(options.forceAfterMs)
    ? Math.max(0, options.forceAfterMs)
    : 300;

  const timer = setTimeout(() => {
    try {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    } catch {
      // ignore force-close failures and fallback to socket destroy
    }

    const tracker = server[SOCKET_TRACKER];
    if (!tracker?.sockets) {
      return;
    }

    for (const socket of tracker.sockets) {
      try {
        socket.destroy();
      } catch {
        // ignore socket destroy failures
      }
    }
  }, delay);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
}

module.exports = {
  attachServerShutdownHandling,
  expediteServerShutdown,
  drainProxyServers,
  PROXY_IDLE_TIMEOUT_MS
};
