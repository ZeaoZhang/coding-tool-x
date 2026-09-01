'use strict';

const fs = require('fs/promises');
const path = require('path');

const { createSecureFileDriver } = require('./secure-file-driver');
function resolveTarget(manifest) {
  if (manifest.mcpFormat !== 'json') throw new Error("Manifest mcpFormat must be 'json'");
  const raw = manifest.resourceMappings && manifest.resourceMappings.mcp;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Manifest requires resourceMappings.mcp');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new Error('MCP mapping must be a filesystem path');
  const home = manifest.paths && manifest.paths.home;
  return path.resolve(home || process.cwd(), raw);
}

function createGenericMcpDriver({ platform, manifest = {}, fsImpl = fs } = {}) {
  return createSecureFileDriver({
    platform,
    capability: 'mcp',
    manifest,
    fsImpl,
    labels: {
      pathContainsSymlink: value => `MCP path contains symlink: ${value}`,
      pathDoesNotExist: value => `MCP path does not exist: ${value}`,
      mappingEscapesHome: 'MCP mapping escapes platform home',
      targetChanged: 'MCP target changed during operation',
      descriptorReadUnavailable: 'MCP descriptor read is unavailable',
      descriptorIdentityUnavailable: 'MCP descriptor identity is unavailable',
      pathComponentNotDirectory: value => `MCP path component is not a directory: ${value}`,
      temporaryPathChanged: 'MCP temporary path changed during write',
      serializedValueMustBeString: 'MCP value must be JSON serializable'
    },
    resolveTarget,
    deserialize: value => JSON.parse(value),
    serialize: value => {
      if (value === undefined) throw new Error('MCP value is required');
      const encoded = JSON.stringify(value, null, 2);
      if (encoded === undefined) throw new Error('MCP value must be JSON serializable');
      return `${encoded}\n`;
    }
  });
}

module.exports = { createGenericMcpDriver };
