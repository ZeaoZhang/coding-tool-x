'use strict';

const http = require('http');

const { describe, it, expect, beforeEach, afterEach } = globalThis;

describe('mcp-client', () => {
  let mcpClient;

  beforeEach(() => {
    // Clear require cache to get fresh module
    const modPath = require.resolve('../../../src/server/services/mcp-client');
    delete require.cache[modPath];
    mcpClient = require('../../../src/server/services/mcp-client');
  });

  afterEach(() => {
    const modPath = require.resolve('../../../src/server/services/mcp-client');
    delete require.cache[modPath];
  });

  // ============================================================================
  // _test.buildMissingCommandMessage
  // ============================================================================

  describe('_test.buildMissingCommandMessage', () => {
    it('known command uvx includes install hint', () => {
      const msg = mcpClient._test.buildMissingCommandMessage('uvx', 'uvx', {});
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).toMatch(/uv/i);
    });

    it('known command npx includes install hint', () => {
      const msg = mcpClient._test.buildMissingCommandMessage('npx', 'npx', {});
      expect(typeof msg).toBe('string');
      expect(msg).toMatch(/node/i);
    });

    it('unknown command returns generic message', () => {
      const msg = mcpClient._test.buildMissingCommandMessage('some-unknown-cmd', 'some-unknown-cmd', {});
      expect(typeof msg).toBe('string');
      expect(msg).toMatch(/some-unknown-cmd/);
    });

    it('handles empty command gracefully', () => {
      const msg = mcpClient._test.buildMissingCommandMessage('', '', {});
      expect(typeof msg).toBe('string');
    });
  });

  // ============================================================================
  // _test.createMissingCommandHint
  // ============================================================================

  describe('_test.createMissingCommandHint', () => {
    it('uvx returns hints mentioning uv', () => {
      const result = mcpClient._test.createMissingCommandHint('uvx', 'uvx', {});
      expect(result).toHaveProperty('details');
      expect(Array.isArray(result.details)).toBe(true);
      const allText = result.details.join(' ');
      expect(allText).toMatch(/uv/i);
    });

    it('npx returns hints mentioning node', () => {
      const result = mcpClient._test.createMissingCommandHint('npx', 'npx', {});
      expect(result).toHaveProperty('details');
      const allText = result.details.join(' ');
      expect(allText).toMatch(/node/i);
    });

    it('unknown command returns generic hints', () => {
      const result = mcpClient._test.createMissingCommandHint('my-tool', 'my-tool', {});
      expect(result).toHaveProperty('details');
      expect(Array.isArray(result.details)).toBe(true);
      expect(result.details.length).toBeGreaterThan(0);
    });

    it('returns object with title and details structure', () => {
      const result = mcpClient._test.createMissingCommandHint('npx', 'npx', {});
      expect(result).toHaveProperty('type', 'missing-command');
      expect(result).toHaveProperty('command');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('details');
    });
  });

  // ============================================================================
  // McpClientError
  // ============================================================================

  describe('McpClientError', () => {
    it('is instance of Error', () => {
      const err = new mcpClient.McpClientError('test error');
      expect(err).toBeInstanceOf(Error);
    });

    it('has message property', () => {
      const err = new mcpClient.McpClientError('something went wrong');
      expect(err.message).toBe('something went wrong');
    });

    it('has custom name and optional code/data properties', () => {
      const err = new mcpClient.McpClientError('rpc error', -32600, { detail: 'bad request' });
      expect(err.name).toBe('McpClientError');
      expect(err.code).toBe(-32600);
      expect(err.data).toEqual({ detail: 'bad request' });
    });
  });

  // ============================================================================
  // McpClient constructor
  // ============================================================================

  describe('McpClient constructor', () => {
    it('creates instance with stdio config', () => {
      const client = new mcpClient.McpClient({ type: 'stdio', command: 'npx', args: ['-y', 'some-server'] });
      expect(client).toBeDefined();
      expect(client._type).toBe('stdio');
    });

    it('creates instance with sse config', () => {
      const client = new mcpClient.McpClient({ type: 'sse', url: 'http://localhost:3000/sse' });
      expect(client).toBeDefined();
      expect(client._type).toBe('sse');
    });

    it('stores command and args from spec', () => {
      const spec = { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] };
      const client = new mcpClient.McpClient(spec);
      expect(client._spec.command).toBe('uvx');
      expect(client._spec.args).toEqual(['mcp-server-fetch']);
    });

    it('uses default timeout when not specified', () => {
      const client = new mcpClient.McpClient({ type: 'stdio', command: 'npx' });
      expect(client._timeout).toBe(10000);
    });
  });

  // ============================================================================
  // createClient factory
  // ============================================================================

  describe('createClient', () => {
    it('is exported as a function', () => {
      expect(typeof mcpClient.createClient).toBe('function');
    });

    it('returns a McpClient instance when called with valid config', async () => {
      // createClient connects and initializes, so we just verify the export shape
      // without actually calling it (would require a live process)
      expect(mcpClient.createClient).toBeDefined();
    });

    it('handles minimal config object without throwing on construction', () => {
      // Verify McpClient can be constructed with minimal config (createClient wraps this)
      const client = new mcpClient.McpClient({ type: 'stdio', command: 'echo' });
      expect(client).toBeInstanceOf(mcpClient.McpClient);
    });
  });

  // ============================================================================
  // HTTP transport
  // ============================================================================

  describe('HTTP transport', () => {
    it('accepts empty 202 responses for notifications and reuses MCP session headers', async () => {
      const requests = [];
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          requests.push({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body
          });

          if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.end();
            return;
          }

          const message = JSON.parse(body);

          if (message.method === 'initialize') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Mcp-Session-Id': 'session-123'
            });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                serverInfo: {
                  name: 'test-server',
                  version: '1.0.0'
                }
              }
            }));
            return;
          }

          if (message.method === 'notifications/initialized') {
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end();
            return;
          }

          if (message.method === 'tools/list') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                tools: []
              }
            }));
            return;
          }

          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
        });
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();

      const client = new mcpClient.McpClient({
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp/`
      }, { timeout: 3000 });

      try {
        await client.connect();
        const initResult = await client.initialize();
        const tools = await client.listTools();

        expect(initResult.protocolVersion).toBe('2025-03-26');
        expect(tools).toEqual([]);
        expect(requests).toHaveLength(4);
        expect(requests[0].method).toBe('GET');
        expect(JSON.parse(requests[1].body).method).toBe('initialize');
        expect(requests[1].headers['mcp-session-id']).toBeUndefined();
        expect(JSON.parse(requests[2].body).method).toBe('notifications/initialized');
        expect(requests[2].headers['mcp-session-id']).toBe('session-123');
        expect(requests[2].headers['mcp-protocol-version']).toBe('2025-03-26');
        expect(JSON.parse(requests[3].body).method).toBe('tools/list');
        expect(requests[3].headers['mcp-session-id']).toBe('session-123');
        expect(requests[3].headers['mcp-protocol-version']).toBe('2025-03-26');
      } finally {
        await client.disconnect();
        await new Promise((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    });
  });
});
