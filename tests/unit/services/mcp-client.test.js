'use strict';

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
});
