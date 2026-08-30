'use strict';

const mcpFormat = require('../mcp-format');
const {
  createProjectAdapter,
  createJsonMcpHandlers
} = require('./shared');

const OMP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/;

function createAdapter({ manifest, fsImpl } = {}) {
  const relativePath = manifest?.projectResources?.mcp?.path;
  const mcpHandlers = createJsonMcpHandlers({
    relativePath,
    format: manifest?.projectResources?.mcp?.format || 'omp-json',
    toNative: mcpFormat.convertToOmpMcpFormat,
    fromNative: mcpFormat.convertFromOmpMcpFormat,
    validateId: id => {
      if (!OMP_SERVER_NAME_PATTERN.test(id)) {
        throw new Error(`OMP MCP server ID "${id}" is invalid`);
      }
    },
    fsImpl
  });
  return createProjectAdapter({ manifest, fsImpl, mcpHandlers });
}

module.exports = { createAdapter };
