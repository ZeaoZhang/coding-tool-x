/**
 * MCP JSON-RPC Client Wrapper
 *
 * Reusable client for communicating with MCP servers over stdio or HTTP/SSE
 * transports using the JSON-RPC 2.0 protocol.
 *
 * Usage:
 *   const client = new McpClient({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-time'] });
 *   await client.connect();
 *   await client.initialize();
 *   const tools = await client.listTools();
 *   const result = await client.callTool('get_current_time', { timezone: 'UTC' });
 *   await client.disconnect();
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const DEFAULT_TIMEOUT = 10000; // 10 seconds
const JSONRPC_VERSION = '2.0';
const MCP_PROTOCOL_VERSION = '2024-11-05';

// ============================================================================
// McpClient
// ============================================================================

class McpClient extends EventEmitter {
  /**
   * @param {object} serverSpec - Server specification
   * @param {string} [serverSpec.type='stdio'] - Transport type: 'stdio' | 'http' | 'sse'
   * @param {string} [serverSpec.command] - Command for stdio transport
   * @param {string[]} [serverSpec.args] - Args for stdio transport
   * @param {object} [serverSpec.env] - Additional env vars for stdio transport
   * @param {string} [serverSpec.cwd] - Working directory for stdio transport
   * @param {string} [serverSpec.url] - URL for http/sse transport
   * @param {object} [serverSpec.headers] - Additional headers for http/sse transport
   * @param {object} [options] - Client options
   * @param {number} [options.timeout=10000] - Operation timeout in ms
   */
  constructor(serverSpec, options = {}) {
    super();
    this._spec = serverSpec;
    this._type = serverSpec.type || 'stdio';
    this._timeout = options.timeout || DEFAULT_TIMEOUT;

    // Internal state
    this._nextId = 1;
    this._pending = new Map();   // id -> { resolve, reject, timer }
    this._connected = false;
    this._initialized = false;
    this._serverCapabilities = null;
    this._serverInfo = null;

    // Stdio transport state
    this._child = null;
    this._stdoutBuffer = '';

    // HTTP/SSE transport state
    this._sseAbortController = null;
    this._httpSessionUrl = null;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Connect to the MCP server (spawn process or open HTTP/SSE connection).
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) {
      throw new McpClientError('Already connected');
    }

    if (this._type === 'stdio') {
      await this._connectStdio();
    } else if (this._type === 'http' || this._type === 'sse') {
      await this._connectHttp();
    } else {
      throw new McpClientError(`Unsupported transport type: ${this._type}`);
    }

    this._connected = true;
    this.emit('connected');
  }

  /**
   * Perform the MCP initialize handshake.
   * Sends initialize request and waits for the server response,
   * then sends the initialized notification.
   * @returns {Promise<object>} Server capabilities
   */
  async initialize() {
    this._assertConnected();

    const result = await this._request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'coding-tool-x',
        version: '1.0.0'
      }
    });

    this._serverCapabilities = result.capabilities || {};
    this._serverInfo = result.serverInfo || {};

    // Send initialized notification (no response expected)
    this._notify('notifications/initialized', {});

    this._initialized = true;
    this.emit('initialized', result);

    return result;
  }

  /**
   * List available tools from the server.
   * @returns {Promise<object[]>} Array of tool definitions
   */
  async listTools() {
    this._assertInitialized();
    const result = await this._request('tools/list', {});
    return result.tools || [];
  }

  /**
   * Call a tool on the server.
   * @param {string} name - Tool name
   * @param {object} [args={}] - Tool arguments
   * @returns {Promise<object>} Tool result
   */
  async callTool(name, args = {}) {
    this._assertInitialized();
    const result = await this._request('tools/call', {
      name,
      arguments: args
    });
    return result;
  }

  /**
   * List available resources from the server.
   * @returns {Promise<object[]>} Array of resource definitions
   */
  async listResources() {
    this._assertInitialized();
    const result = await this._request('resources/list', {});
    return result.resources || [];
  }

  /**
   * List available prompts from the server.
   * @returns {Promise<object[]>} Array of prompt definitions
   */
  async listPrompts() {
    this._assertInitialized();
    const result = await this._request('prompts/list', {});
    return result.prompts || [];
  }

  /**
   * Disconnect and clean up all resources.
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this._connected) return;

    // Reject all pending requests
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpClientError('Client disconnected'));
    }
    this._pending.clear();

    if (this._type === 'stdio') {
      await this._disconnectStdio();
    } else {
      this._disconnectHttp();
    }

    this._connected = false;
    this._initialized = false;
    this.emit('disconnected');
  }

  /**
   * Whether the client is currently connected.
   * @returns {boolean}
   */
  get connected() {
    return this._connected;
  }

  /**
   * Whether the client has completed initialization.
   * @returns {boolean}
   */
  get initialized() {
    return this._initialized;
  }

  /**
   * Server capabilities returned during initialization.
   * @returns {object|null}
   */
  get serverCapabilities() {
    return this._serverCapabilities;
  }

  /**
   * Server info returned during initialization.
   * @returns {object|null}
   */
  get serverInfo() {
    return this._serverInfo;
  }

  // --------------------------------------------------------------------------
  // Stdio transport
  // --------------------------------------------------------------------------

  /** @private */
  async _connectStdio() {
    const { command, args = [], env, cwd } = this._spec;

    if (!command) {
      throw new McpClientError('stdio transport requires a "command" field');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._killChild();
        reject(new McpClientError(`Connection timeout after ${this._timeout}ms`));
      }, this._timeout);

      try {
        // 确保 PATH 不被覆盖，优先使用用户提供的 env，但保留 PATH
        const mergedEnv = { ...process.env, ...env };
        // 如果用户提供的 env 中有 PATH，将其追加到系统 PATH 前面
        if (env && env.PATH && process.env.PATH) {
          mergedEnv.PATH = `${env.PATH}:${process.env.PATH}`;
        }

        this._child = spawn(command, args, {
          env: mergedEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: cwd || process.cwd()
        });
      } catch (err) {
        clearTimeout(timer);
        throw new McpClientError(`Failed to spawn "${command}": ${err.message}`);
      }

      // Once we get the spawn event (or first stdout), consider connected
      let settled = false;

      const settle = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };

      this._child.on('spawn', () => {
        // Process spawned successfully - set up data handlers then resolve
        this._setupStdioHandlers();
        settle(null);
      });

      this._child.on('error', (err) => {
        if (err.code === 'ENOENT') {
          const pathHint = mergedEnv.PATH
            ? `\n  Current PATH: ${mergedEnv.PATH.split(':').slice(0, 5).join(':')}\n  (showing first 5 entries)`
            : '\n  PATH is not set!';
          settle(new McpClientError(
            `Command "${command}" not found. Please check:\n` +
            `  1. Is "${command}" installed?\n` +
            `  2. Try using absolute path (e.g., /usr/bin/node or $(which ${command}))\n` +
            `  3. Check your PATH environment variable${pathHint}`
          ));
        } else {
          settle(new McpClientError(`Failed to start process: ${err.message}`));
        }
      });

      // If the process exits before we consider it connected
      this._child.on('close', (code, signal) => {
        settle(new McpClientError(
          `Process exited before connection established (code=${code}, signal=${signal})`
        ));
      });
    });
  }

  /** @private */
  _setupStdioHandlers() {
    const child = this._child;

    child.stdout.on('data', (chunk) => {
      this._stdoutBuffer += chunk.toString();
      this._processStdoutBuffer();
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        this.emit('stderr', text);
      }
    });

    // Remove the initial 'close' listener that was for connection detection
    child.removeAllListeners('close');
    child.removeAllListeners('error');

    child.on('close', (code, signal) => {
      if (this._connected) {
        this._connected = false;
        this._initialized = false;

        // Reject all pending with crash error
        for (const [id, pending] of this._pending) {
          clearTimeout(pending.timer);
          pending.reject(new McpClientError(
            `Server process exited unexpectedly (code=${code}, signal=${signal})`
          ));
        }
        this._pending.clear();

        this.emit('crash', { code, signal });
        this.emit('disconnected');
      }
    });

    child.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /** @private */
  _processStdoutBuffer() {
    // JSON-RPC over stdio uses newline-delimited JSON
    let newlineIdx;
    while ((newlineIdx = this._stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this._stdoutBuffer.slice(0, newlineIdx).trim();
      this._stdoutBuffer = this._stdoutBuffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch (err) {
        // Not valid JSON - could be a log line from the server, ignore
        this.emit('stderr', `[non-json stdout]: ${line}`);
      }
    }
  }

  /** @private */
  _sendStdio(msg) {
    if (!this._child || this._child.killed) {
      throw new McpClientError('Process is not running');
    }
    const data = JSON.stringify(msg) + '\n';
    this._child.stdin.write(data);
  }

  /** @private */
  async _disconnectStdio() {
    return new Promise((resolve) => {
      if (!this._child || this._child.killed) {
        resolve();
        return;
      }

      const child = this._child;
      this._child = null;

      // Give the process a chance to exit gracefully
      const forceTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
        resolve();
      }, 2000);

      child.on('close', () => {
        clearTimeout(forceTimer);
        resolve();
      });

      // Close stdin to signal EOF, then SIGTERM
      try {
        child.stdin.end();
      } catch (e) {
        // stdin might already be closed
      }

      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      }, 500);
    });
  }

  /** @private */
  _killChild() {
    if (this._child && !this._child.killed) {
      try {
        this._child.kill('SIGKILL');
      } catch (e) {
        // ignore
      }
      this._child = null;
    }
  }

  // --------------------------------------------------------------------------
  // HTTP/SSE transport
  // --------------------------------------------------------------------------

  /** @private */
  async _connectHttp() {
    const { url } = this._spec;

    if (!url) {
      throw new McpClientError('http/sse transport requires a "url" field');
    }

    // For HTTP transport, we verify the server is reachable with a GET request.
    // The MCP Streamable HTTP transport uses a single endpoint for both
    // POST (JSON-RPC requests) and GET (SSE event stream).
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new McpClientError(`HTTP connection timeout after ${this._timeout}ms`));
      }, this._timeout);

      try {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          timeout: this._timeout,
          headers: {
            'Accept': 'text/event-stream',
            ...this._spec.headers
          }
        };

        const req = client.request(options, (res) => {
          clearTimeout(timer);

          if (res.statusCode >= 200 && res.statusCode < 400) {
            // Store the base URL for sending requests
            this._httpSessionUrl = url;
            // We don't keep this SSE connection open during connect;
            // we will open a new one per request or use POST.
            res.destroy();
            resolve();
          } else {
            res.destroy();
            reject(new McpClientError(`HTTP server returned status ${res.statusCode}`));
          }
        });

        req.on('error', (err) => {
          clearTimeout(timer);
          reject(new McpClientError(`HTTP connection failed: ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          clearTimeout(timer);
          reject(new McpClientError(`HTTP connection timeout after ${this._timeout}ms`));
        });

        req.end();
      } catch (err) {
        clearTimeout(timer);
        reject(new McpClientError(`Invalid URL: ${err.message}`));
      }
    });
  }

  /** @private */
  _sendHttp(msg) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new McpClientError(`HTTP send timeout after ${this._timeout}ms`));
      }, this._timeout);

      try {
        const parsedUrl = new URL(this._httpSessionUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const body = JSON.stringify(msg);

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          timeout: this._timeout,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Accept': 'application/json, text/event-stream',
            ...this._spec.headers
          }
        };

        const req = client.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString(); });
          res.on('end', () => {
            clearTimeout(timer);

            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new McpClientError(`HTTP ${res.statusCode}: ${data}`));
              return;
            }

            const contentType = res.headers['content-type'] || '';

            // JSON response (direct response to JSON-RPC)
            if (contentType.includes('application/json')) {
              try {
                const parsed = JSON.parse(data);
                this._handleMessage(parsed);
                resolve();
              } catch (err) {
                reject(new McpClientError(`Invalid JSON response: ${err.message}`));
              }
              return;
            }

            // SSE response (streamed events)
            if (contentType.includes('text/event-stream')) {
              this._parseSsePayload(data);
              resolve();
              return;
            }

            // Accepted with no body (202, notifications)
            if (res.statusCode === 202 || !data.trim()) {
              resolve();
              return;
            }

            // Try parsing as JSON anyway
            try {
              const parsed = JSON.parse(data);
              this._handleMessage(parsed);
              resolve();
            } catch (err) {
              resolve(); // Non-JSON, non-SSE - just accept it
            }
          });
        });

        req.on('error', (err) => {
          clearTimeout(timer);
          reject(new McpClientError(`HTTP request failed: ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          clearTimeout(timer);
          reject(new McpClientError(`HTTP request timeout`));
        });

        req.write(body);
        req.end();
      } catch (err) {
        clearTimeout(timer);
        reject(new McpClientError(`HTTP send error: ${err.message}`));
      }
    });
  }

  /** @private */
  _parseSsePayload(data) {
    // Parse Server-Sent Events format
    const lines = data.split('\n');
    let eventData = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        eventData += line.slice(6);
      } else if (line === '' && eventData) {
        try {
          const msg = JSON.parse(eventData);
          this._handleMessage(msg);
        } catch (err) {
          this.emit('stderr', `[invalid SSE data]: ${eventData}`);
        }
        eventData = '';
      }
    }

    // Handle trailing data without a final empty line
    if (eventData) {
      try {
        const msg = JSON.parse(eventData);
        this._handleMessage(msg);
      } catch (err) {
        this.emit('stderr', `[invalid SSE data]: ${eventData}`);
      }
    }
  }

  /** @private */
  _disconnectHttp() {
    this._httpSessionUrl = null;
  }

  // --------------------------------------------------------------------------
  // JSON-RPC 2.0 framing
  // --------------------------------------------------------------------------

  /** @private */
  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;

      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new McpClientError(`Request "${method}" timed out after ${this._timeout}ms`));
      }, this._timeout);

      this._pending.set(id, { resolve, reject, timer, method });

      const msg = {
        jsonrpc: JSONRPC_VERSION,
        id,
        method,
        params: params || {}
      };

      try {
        if (this._type === 'stdio') {
          this._sendStdio(msg);
        } else {
          this._sendHttp(msg).catch((err) => {
            if (this._pending.has(id)) {
              clearTimeout(timer);
              this._pending.delete(id);
              reject(err);
            }
          });
        }
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(new McpClientError(`Failed to send request: ${err.message}`));
      }
    });
  }

  /** @private */
  _notify(method, params) {
    const msg = {
      jsonrpc: JSONRPC_VERSION,
      method,
      params: params || {}
    };

    try {
      if (this._type === 'stdio') {
        this._sendStdio(msg);
      } else {
        // Fire-and-forget for HTTP notifications
        this._sendHttp(msg).catch((err) => {
          this.emit('error', new McpClientError(`Notification send failed: ${err.message}`));
        });
      }
    } catch (err) {
      this.emit('error', new McpClientError(`Notification send failed: ${err.message}`));
    }
  }

  /** @private */
  _handleMessage(msg) {
    // JSON-RPC response (has id, has result or error)
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this._pending.get(msg.id);
      if (!pending) {
        // Could be a server-initiated request; emit for external handling
        this.emit('server-request', msg);
        return;
      }

      clearTimeout(pending.timer);
      this._pending.delete(msg.id);

      if (msg.error) {
        const err = new McpClientError(
          msg.error.message || 'Unknown server error',
          msg.error.code,
          msg.error.data
        );
        pending.reject(err);
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // JSON-RPC notification (has method, no id)
    if (msg.method) {
      this.emit('notification', { method: msg.method, params: msg.params });
      return;
    }

    // Unknown message shape
    this.emit('unknown-message', msg);
  }

  // --------------------------------------------------------------------------
  // Assertions
  // --------------------------------------------------------------------------

  /** @private */
  _assertConnected() {
    if (!this._connected) {
      throw new McpClientError('Not connected. Call connect() first.');
    }
  }

  /** @private */
  _assertInitialized() {
    this._assertConnected();
    if (!this._initialized) {
      throw new McpClientError('Not initialized. Call initialize() first.');
    }
  }
}

// ============================================================================
// McpClientError
// ============================================================================

class McpClientError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} [code] - JSON-RPC error code
   * @param {*} [data] - Additional error data
   */
  constructor(message, code, data) {
    super(message);
    this.name = 'McpClientError';
    this.code = code || undefined;
    this.data = data || undefined;
  }
}

// ============================================================================
// Convenience factory
// ============================================================================

/**
 * Create and connect an McpClient in one call.
 * Returns a fully initialized client ready for tool calls.
 *
 * @param {object} serverSpec - Server specification (same as McpClient constructor)
 * @param {object} [options] - Client options
 * @returns {Promise<McpClient>} Connected and initialized client
 */
async function createClient(serverSpec, options = {}) {
  const client = new McpClient(serverSpec, options);
  await client.connect();
  await client.initialize();
  return client;
}

module.exports = {
  McpClient,
  McpClientError,
  createClient
};
