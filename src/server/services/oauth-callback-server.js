'use strict';

const http = require('http');
const url = require('url');

// Store active servers by port
const activeServers = new Map();

// Default timeout for auto-close (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

// Delay before closing server after callback (1 second)
const CLOSE_DELAY_MS = 1000;

/**
 * Generate HTML response page
 * @param {boolean} success - Whether authorization was successful
 * @param {string} [errorMessage] - Error message if failed
 * @returns {string} HTML content
 */
function generateHtmlResponse(success, errorMessage) {
  const title = success ? 'Authorization Successful' : 'Authorization Failed';
  const titleCn = success ? '授权成功' : '授权失败';
  const message = success
    ? 'You can close this window now.'
    : `Error: ${errorMessage || 'Unknown error'}`;
  const messageCn = success
    ? '您现在可以关闭此窗口。'
    : `错误: ${errorMessage || '未知错误'}`;
  const icon = success ? '&#10004;' : '&#10006;';
  const color = success ? '#4CAF50' : '#f44336';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 400px;
      width: 100%;
    }
    .icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: ${color};
      color: white;
      font-size: 40px;
      line-height: 80px;
      margin: 0 auto 24px;
    }
    h1 {
      color: #333;
      font-size: 24px;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #666;
      font-size: 14px;
      margin-bottom: 16px;
    }
    p {
      color: #555;
      font-size: 16px;
      line-height: 1.5;
    }
    .error-detail {
      background: #fff3f3;
      border: 1px solid #ffcdd2;
      border-radius: 8px;
      padding: 12px;
      margin-top: 16px;
      color: #c62828;
      font-size: 14px;
      word-break: break-word;
    }
    .auto-close {
      margin-top: 24px;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p class="subtitle">${titleCn}</p>
    <p>${message}</p>
    <p style="color: #888; font-size: 14px; margin-top: 8px;">${messageCn}</p>
    ${!success && errorMessage ? `<div class="error-detail">${errorMessage}</div>` : ''}
    <p class="auto-close">This window will close automatically...</p>
  </div>
  <script>
    setTimeout(function() { window.close(); }, 3000);
  </script>
</body>
</html>`;
}

/**
 * Start OAuth callback server
 * @param {number} port - Port to listen on
 * @param {string} callbackPath - Path to handle callbacks (e.g., '/callback')
 * @param {Function} onCallback - Callback function with { code, state, error, errorDescription }
 * @returns {Promise<http.Server>} The HTTP server instance
 */
async function startCallbackServer(port, callbackPath, onCallback) {
  // Check if server is already running on this port
  if (activeServers.has(port)) {
    throw new Error(`OAuth callback server already running on port ${port}`);
  }

  // Normalize callback path
  const normalizedPath = callbackPath.startsWith('/') ? callbackPath : `/${callbackPath}`;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      // Only handle the callback path
      if (pathname !== normalizedPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      // Parse query parameters
      const query = parsedUrl.query;
      const code = query.code || null;
      const state = query.state || null;
      const error = query.error || null;
      const errorDescription = query.error_description || null;

      // Determine success/failure
      const success = !error && code;
      const errorMessage = error
        ? `${error}${errorDescription ? `: ${errorDescription}` : ''}`
        : null;

      // Send HTML response
      res.writeHead(success ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateHtmlResponse(success, errorMessage));

      // Call the callback
      try {
        onCallback({
          code,
          state,
          error,
          errorDescription
        });
      } catch (err) {
        console.error('Error in OAuth callback handler:', err);
      }

      // Auto-close server after delay
      setTimeout(() => {
        stopCallbackServer(port);
      }, CLOSE_DELAY_MS);
    });

    // Set up timeout for auto-close
    const timeoutId = setTimeout(() => {
      if (activeServers.has(port)) {
        console.log(`OAuth callback server on port ${port} timed out, closing...`);
        stopCallbackServer(port);
      }
    }, DEFAULT_TIMEOUT_MS);

    // Handle server errors
    server.on('error', (err) => {
      clearTimeout(timeoutId);
      activeServers.delete(port);

      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Please try a different port or close the application using it.`));
      } else if (err.code === 'EACCES') {
        reject(new Error(`Permission denied to bind to port ${port}. Try a port number above 1024.`));
      } else {
        reject(new Error(`Failed to start OAuth callback server: ${err.message}`));
      }
    });

    // Start listening
    server.listen(port, '127.0.0.1', () => {
      // Store server info
      activeServers.set(port, {
        server,
        timeoutId,
        callbackPath: normalizedPath
      });

      console.log(`OAuth callback server started on http://127.0.0.1:${port}${normalizedPath}`);
      resolve(server);
    });
  });
}

/**
 * Stop OAuth callback server
 * @param {number} port - Port of the server to stop
 * @returns {boolean} True if server was stopped, false if not found
 */
function stopCallbackServer(port) {
  const serverInfo = activeServers.get(port);

  if (!serverInfo) {
    return false;
  }

  // Clear timeout
  if (serverInfo.timeoutId) {
    clearTimeout(serverInfo.timeoutId);
  }

  // Close server
  try {
    serverInfo.server.close();
    console.log(`OAuth callback server on port ${port} stopped`);
  } catch (err) {
    console.error(`Error stopping OAuth callback server on port ${port}:`, err.message);
  }

  activeServers.delete(port);
  return true;
}

/**
 * Check if server is running on port
 * @param {number} port - Port to check
 * @returns {boolean} True if server is running
 */
function isServerRunning(port) {
  return activeServers.has(port);
}

/**
 * Get all active server ports
 * @returns {number[]} Array of active ports
 */
function getActiveServers() {
  return Array.from(activeServers.keys());
}

/**
 * Stop all active servers
 * @returns {number} Number of servers stopped
 */
function stopAllServers() {
  const ports = getActiveServers();
  ports.forEach(port => stopCallbackServer(port));
  return ports.length;
}

module.exports = {
  startCallbackServer,
  stopCallbackServer,
  isServerRunning,
  getActiveServers,
  stopAllServers
};
