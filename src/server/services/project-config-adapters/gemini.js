'use strict';

const mcpFormat = require('../mcp-format');
const {
  createProjectAdapter,
  createJsonMcpHandlers
} = require('./shared');

function createAdapter({ manifest, fsImpl } = {}) {
  const relativePath = manifest?.projectResources?.mcp?.path;
  const mcpHandlers = createJsonMcpHandlers({
    relativePath,
    format: manifest?.projectResources?.mcp?.format || 'gemini-json',
    toNative: mcpFormat.extractServerSpec,
    fromNative: value => ({ ...value }),
    fsImpl
  });
  return createProjectAdapter({ manifest, fsImpl, mcpHandlers });
}

module.exports = { createAdapter };
