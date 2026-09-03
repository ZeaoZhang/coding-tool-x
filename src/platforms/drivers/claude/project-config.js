'use strict';

const mcpFormat = require('../../../shared/mcp-format');
const {
  createProjectAdapter,
  createJsonMcpHandlers
} = require('../../../shared/project-config');

function createAdapter({ manifest, fsImpl } = {}) {
  const relativePath = manifest?.projectResources?.mcp?.path;
  const mcpHandlers = createJsonMcpHandlers({
    relativePath,
    format: manifest?.projectResources?.mcp?.format || 'claude-json',
    toNative: mcpFormat.extractServerSpec,
    fromNative: value => ({ ...value }),
    fsImpl
  });
  return createProjectAdapter({ manifest, fsImpl, mcpHandlers });
}

module.exports = { createAdapter };
