'use strict';

const mcpFormat = require('../../../shared/mcp-format');
const {
  createProjectAdapter,
  createJsonMcpHandlers,
  validateMcpId
} = require('../../../shared/project-config');

function createAdapter({ manifest, fsImpl } = {}) {
  const relativePath = manifest?.projectResources?.mcp?.path;
  const mcpHandlers = createJsonMcpHandlers({
    relativePath,
    format: manifest?.projectResources?.mcp?.format || 'omp-json',
    toNative: mcpFormat.convertToOmpMcpFormat,
    fromNative: mcpFormat.convertFromOmpMcpFormat,
    validateId: id => {
      try {
        return validateMcpId(id);
      } catch {
        throw new Error(`OMP MCP server ID "${id}" is invalid`);
      }
    },
    fsImpl
  });
  return createProjectAdapter({ manifest, fsImpl, mcpHandlers });
}

module.exports = { createAdapter };
