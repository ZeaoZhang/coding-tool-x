/**
 * MCP JSON-RPC Client Wrapper
 *
 * Reusable client for communicating with MCP servers over stdio, Streamable
 * HTTP, or legacy SSE transports using the JSON-RPC 2.0 protocol.
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
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const DEFAULT_TIMEOUT = 10000; // 10 seconds
const JSONRPC_VERSION = '2.0';
const MCP_PROTOCOL_VERSION = '2024-11-05';

function getPathEnvKey(envObj = {}) {
  return Object.keys(envObj).find(key => key.toLowerCase() === 'path') || 'PATH';
}

function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function mergeSpawnEnv(extraEnv = {}) {
  const mergedEnv = { ...process.env, ...extraEnv };
  const processPathKey = getPathEnvKey(process.env);
  const extraPathKey = getPathEnvKey(extraEnv);
  const mergedPathKey = getPathEnvKey(mergedEnv);

  const extraPath = extraEnv && typeof extraEnv[extraPathKey] === 'string'
    ? extraEnv[extraPathKey]
    : '';
  const processPath = process.env && typeof process.env[processPathKey] === 'string'
    ? process.env[processPathKey]
    : '';

  if (extraPath && processPath) {
    mergedEnv[mergedPathKey] = `${extraPath}${path.delimiter}${processPath}`;
  }

  return mergedEnv;
}

function resolveWindowsSpawnCommand(command, env, cwd) {
  if (process.platform !== 'win32') {
    return stripWrappingQuotes(command);
  }

  const normalizedCommand = stripWrappingQuotes(command);
  if (!normalizedCommand) {
    return normalizedCommand;
  }

  const hasPathSegment = /[\\/]/.test(normalizedCommand) || /^[a-zA-Z]:/.test(normalizedCommand);
  const hasExtension = path.extname(normalizedCommand).length > 0;
  const extensions = hasExtension ? [''] : ['.cmd', '.exe', '.bat', '.com'];
  const resolveCandidate = (basePath) => {
    for (const ext of extensions) {
      const candidate = ext ? `${basePath}${ext}` : basePath;
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  if (hasPathSegment) {
    const absoluteBasePath = path.isAbsolute(normalizedCommand)
      ? normalizedCommand
      : path.resolve(cwd || process.cwd(), normalizedCommand);
    return resolveCandidate(absoluteBasePath) || normalizedCommand;
  }

  const pathKey = getPathEnvKey(env || process.env);
  const pathValue = env && typeof env[pathKey] === 'string' ? env[pathKey] : '';
  if (!pathValue) {
    return normalizedCommand;
  }

  const searchPaths = pathValue.split(path.delimiter).filter(Boolean);
  for (const searchPath of searchPaths) {
    const found = resolveCandidate(path.join(searchPath.trim(), normalizedCommand));
    if (found) {
      return found;
    }
  }

  return normalizedCommand;
}

function getCommandInstallHint(command) {
  const normalized = path.basename(stripWrappingQuotes(command)).toLowerCase()

  if (['node', 'node.exe', 'npm', 'npm.cmd', 'npx', 'npx.cmd'].includes(normalized)) {
    return '请先安装 Node.js，并确认 `node` / `npm` / `npx` 已加入 PATH。'
  }

  if (['uv', 'uv.exe', 'uvx', 'uvx.exe'].includes(normalized)) {
    return '请先安装 `uv`，并确认 `uv` / `uvx` 可以在终端直接执行。'
  }

  if (['python', 'python.exe', 'python3', 'py'].includes(normalized)) {
    return '请先安装 Python，并确认对应命令已加入 PATH。'
  }

  if (process.platform === 'win32' && ['netstat', 'taskkill'].includes(normalized)) {
    return '请确认 Windows 自带命令可用，并检查 `C:\\Windows\\System32` 是否在 PATH 中。'
  }

  return `请确认已安装 "${command}"，或改用可执行文件的绝对路径。`
}

function createMissingCommandHint(command, resolvedCommand, env = {}) {
  const pathKey = getPathEnvKey(env)
  const pathValue = typeof env[pathKey] === 'string' ? env[pathKey] : ''
  const pathPreview = pathValue
    ? pathValue.split(path.delimiter).slice(0, 5).join(path.delimiter)
    : ''
  const commandHint = resolvedCommand === command
    ? command
    : `${command} (resolved: ${resolvedCommand})`

  const details = [
    getCommandInstallHint(command),
    process.platform === 'win32'
      ? 'Windows 可优先尝试 `.cmd` / `.exe` 文件，必要时直接填写绝对路径。'
      : `可尝试填写绝对路径（例如 \`/usr/bin/node\` 或 \`$(which ${command})\`）。`
  ]

  if (pathPreview) {
    details.push(`当前 PATH 前 5 项: ${pathPreview}`)
  } else {
    details.push('当前 PATH 为空，请检查环境变量配置。')
  }

  return {
    type: 'missing-command',
    command,
    resolvedCommand,
    title: `命令 "${commandHint}" 未找到`,
    details
  }
}

function buildMissingCommandMessage(command, resolvedCommand, env = {}) {
  const hint = createMissingCommandHint(command, resolvedCommand, env)
  return [hint.title, ...hint.details].join('\n')
}

function parseSseEvent(block = '') {
  const lines = String(block).split('\n');
  const dataLines = [];
  let eventType = 'message';

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) {
      continue;
    }

    const separatorIdx = line.indexOf(':');
    const field = separatorIdx === -1 ? line : line.slice(0, separatorIdx);
    let value = separatorIdx === -1 ? '' : line.slice(separatorIdx + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      eventType = value || 'message';
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    eventType,
    data: dataLines.join('\n')
  };
}

function resolveLegacySseEndpoint(baseUrl, endpoint) {
  const endpointText = String(endpoint || '').trim();
  if (!endpointText) {
    throw new McpClientError('SSE endpoint event did not include a request URL');
  }
  return new URL(endpointText, baseUrl).toString();
}

// ============================================================================
// McpClient
// ============================================================================

class McpClient extends EventEmitter {
  /**
   * @param {object} serverSpec - Server specification
   * @param {string} [serverSpec.type='stdio'] - Transport type: 'stdio' | 'streamable_http' | 'sse'
   * @param {string} [serverSpec.command] - Command for stdio transport
   * @param {string[]} [serverSpec.args] - Args for stdio transport
   * @param {object} [serverSpec.env] - Additional env vars for stdio transport
   * @param {string} [serverSpec.cwd] - Working directory for stdio transport
   * @param {string} [serverSpec.url] - URL for streamable_http/sse transport
   * @param {object} [serverSpec.headers] - Additional headers for streamable_http/sse transport
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
    this._httpSessionId = null;
    this._legacySseMode = false;
    this._sseRequest = null;
    this._sseResponse = null;
    this._sseBuffer = '';
    this._negotiatedProtocolVersion = MCP_PROTOCOL_VERSION;
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
    } else if (this._type === 'streamable_http' || this._type === 'sse') {
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

    this._negotiatedProtocolVersion = result.protocolVersion || MCP_PROTOCOL_VERSION;
    this._serverCapabilities = result.capabilities || {};
    this._serverInfo = result.serverInfo || {};

    // Send initialized notification (no response expected)
    await this._notify('notifications/initialized', {});

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

      const finalCwd = cwd || process.cwd();
      const mergedEnv = mergeSpawnEnv(env || {});
      const resolvedCommand = resolveWindowsSpawnCommand(command, mergedEnv, finalCwd);

      try {
        this._child = spawn(resolvedCommand, args, {
          env: mergedEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: finalCwd,
          windowsHide: true
        });
      } catch (err) {
        clearTimeout(timer);
        throw new McpClientError(`Failed to spawn "${resolvedCommand}": ${err.message}`);
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
          const hint = createMissingCommandHint(command, resolvedCommand, mergedEnv)
          settle(new McpClientError(
            buildMissingCommandMessage(command, resolvedCommand, mergedEnv),
            undefined,
            { hint }
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
      throw new McpClientError('streamable_http/sse transport requires a "url" field');
    }

    try {
      new URL(url);
    } catch (err) {
      throw new McpClientError(`Invalid URL: ${err.message}`);
    }

    if (this._type === 'sse') {
      await this._connectLegacySse();
      return;
    }

    // Streamable HTTP sends each JSON-RPC message as a POST to the MCP endpoint.
    // Do not probe with GET here: valid servers may return 405 when they do not
    // expose an unsolicited SSE stream on the same endpoint.
    this._httpSessionUrl = url;
  }

  /** @private */
  async _connectLegacySse() {
    const { url } = this._spec;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        cleanup();
        reject(new McpClientError(`SSE connection timeout after ${this._timeout}ms`));
      }, this._timeout);

      const cleanup = () => {
        clearTimeout(timer);
        if (this._sseRequest && !this._sseRequest.destroyed) {
          this._sseRequest.destroy();
        }
        if (this._sseResponse && !this._sseResponse.destroyed) {
          this._sseResponse.destroy();
        }
        this._sseRequest = null;
        this._sseResponse = null;
      };

      const settle = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          cleanup();
          reject(err);
        } else {
          resolve();
        }
      };

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
          this._sseResponse = res;

          if (res.statusCode >= 200 && res.statusCode < 400) {
            const contentType = res.headers['content-type'] || '';
            if (!contentType.includes('text/event-stream')) {
              settle(new McpClientError(`SSE endpoint returned unsupported content type: ${contentType || 'unknown'}`));
              return;
            }

            res.on('data', (chunk) => {
              this._sseBuffer += chunk.toString();
              const events = this._drainSseEvents();

              for (const event of events) {
                if (!settled && event.eventType === 'endpoint') {
                  try {
                    this._httpSessionUrl = resolveLegacySseEndpoint(url, event.data);
                    this._legacySseMode = true;
                    settle(null);
                  } catch (err) {
                    settle(err);
                  }
                  continue;
                }

                this._handleSseEvent(event);
              }
            });

            res.on('end', () => {
              if (!settled) {
                settle(new McpClientError('SSE endpoint closed before endpoint event'));
                return;
              }
              this._handleHttpDisconnect('SSE stream closed');
            });

            res.on('error', (err) => {
              if (!settled) {
                settle(new McpClientError(`SSE stream error: ${err.message}`));
                return;
              }
              this._handleHttpDisconnect(`SSE stream error: ${err.message}`);
            });
          } else {
            res.resume();
            settle(new McpClientError(`SSE server returned status ${res.statusCode}`));
          }
        });

        this._sseRequest = req;

        req.on('error', (err) => {
          settle(new McpClientError(`SSE connection failed: ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          settle(new McpClientError(`SSE connection timeout after ${this._timeout}ms`));
        });

        req.end();
      } catch (err) {
        settle(new McpClientError(`Invalid URL: ${err.message}`));
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
            ...(msg.method !== 'initialize'
              ? {
                'MCP-Protocol-Version': this._negotiatedProtocolVersion || MCP_PROTOCOL_VERSION,
                ...(this._httpSessionId ? { 'Mcp-Session-Id': this._httpSessionId } : {})
              }
              : {}),
            ...this._spec.headers
          }
        };

        const req = client.request(options, (res) => {
          this._captureHttpResponseMetadata(res);
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString(); });
          res.on('end', () => {
            clearTimeout(timer);

            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new McpClientError(`HTTP ${res.statusCode}: ${data}`));
              return;
            }

            const isNotification = msg.id === undefined || msg.id === null;
            const contentType = res.headers['content-type'] || '';
            const trimmedData = data.trim();

            if (!trimmedData) {
              if (isNotification || res.statusCode === 204 || (res.statusCode === 202 && this._legacySseMode)) {
                resolve();
                return;
              }

              reject(new McpClientError('Empty HTTP response for request'));
              return;
            }

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
    const previousBuffer = this._sseBuffer;
    this._sseBuffer = data;
    const events = this._drainSseEvents({ flush: true });
    this._sseBuffer = previousBuffer;

    for (const event of events) {
      this._handleSseEvent(event);
    }
  }

  /** @private */
  _drainSseEvents({ flush = false } = {}) {
    const events = [];
    let normalized = this._sseBuffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let delimiterIdx;

    while ((delimiterIdx = normalized.indexOf('\n\n')) !== -1) {
      const block = normalized.slice(0, delimiterIdx);
      normalized = normalized.slice(delimiterIdx + 2);
      const event = parseSseEvent(block);
      if (event && event.data) {
        events.push(event);
      }
    }

    if (flush && normalized.trim()) {
      const event = parseSseEvent(normalized);
      if (event && event.data) {
        events.push(event);
      }
      normalized = '';
    }

    this._sseBuffer = normalized;
    return events;
  }

  /** @private */
  _handleSseEvent(event) {
    if (!event || !event.data || event.data === '[DONE]') {
      return;
    }

    if (event.eventType === 'endpoint') {
      return;
    }

    try {
      const msg = JSON.parse(event.data);
      this._handleMessage(msg);
    } catch (err) {
      this.emit('stderr', `[invalid SSE data]: ${event.data}`);
    }
  }

  /** @private */
  _handleHttpDisconnect(message) {
    if (!this._connected) {
      return;
    }

    this._connected = false;
    this._initialized = false;

    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpClientError(message));
    }
    this._pending.clear();

    this.emit('disconnected');
  }

  /** @private */
  _disconnectHttp() {
    if (this._sseRequest && !this._sseRequest.destroyed) {
      try {
        this._sseRequest.destroy();
      } catch (e) {
        // ignore
      }
    }
    if (this._sseResponse && !this._sseResponse.destroyed) {
      try {
        this._sseResponse.destroy();
      } catch (e) {
        // ignore
      }
    }
    this._sseRequest = null;
    this._sseResponse = null;
    this._sseBuffer = '';
    this._httpSessionUrl = null;
    this._httpSessionId = null;
    this._legacySseMode = false;
    this._negotiatedProtocolVersion = MCP_PROTOCOL_VERSION;
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
  async _notify(method, params) {
    const msg = {
      jsonrpc: JSONRPC_VERSION,
      method,
      params: params || {}
    };

    try {
      if (this._type === 'stdio') {
        this._sendStdio(msg);
        return;
      } else {
        await this._sendHttp(msg);
      }
    } catch (err) {
      throw new McpClientError(`Notification send failed: ${err.message}`);
    }
  }

  /** @private */
  _captureHttpResponseMetadata(res) {
    const sessionId = res && res.headers ? res.headers['mcp-session-id'] : null;
    if (typeof sessionId === 'string' && sessionId.trim()) {
      this._httpSessionId = sessionId.trim();
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
  createClient,
  buildMissingCommandMessage,
  createMissingCommandHint,
  _test: {
    createMissingCommandHint,
    buildMissingCommandMessage
  }
};
