const SOCKET_TRACKER = Symbol('ccTool.socketTracker');

function attachServerShutdownHandling(server, options = {}) {
  if (!server || server[SOCKET_TRACKER]) {
    return server;
  }

  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  const keepAliveTimeout = Number.isFinite(options.keepAliveTimeout)
    ? Math.max(0, options.keepAliveTimeout)
    : 1000;
  const headersTimeout = Number.isFinite(options.headersTimeout)
    ? Math.max(keepAliveTimeout + 1000, options.headersTimeout)
    : keepAliveTimeout + 1000;

  server.keepAliveTimeout = keepAliveTimeout;
  server.headersTimeout = headersTimeout;
  server[SOCKET_TRACKER] = { sockets };
  return server;
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
  expediteServerShutdown
};
