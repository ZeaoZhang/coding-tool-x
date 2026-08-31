'use strict';

const mcpFormat = require('../mcp-format');
const {
  createProjectAdapter,
  readJsonFile,
  writeJsonFileAtomic,
  redactSecrets
} = require('./shared');

function getOpenCodeServers(projectRoot, relativePath, fsImpl) {
  const config = readJsonFile(projectRoot, relativePath, {}, fsImpl);
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};

  if (config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp)) {
    if (config.mcp.servers && typeof config.mcp.servers === 'object' && !Array.isArray(config.mcp.servers)) {
      return { config, servers: config.mcp.servers, nested: true };
    }
    return { config, servers: config.mcp, nested: false };
  }

  config.mcp = {};
  return { config, servers: config.mcp, nested: false };
}

function createAdapter({ manifest, fsImpl } = {}) {
  const relativePath = manifest?.projectResources?.mcp?.path;
  const format = manifest?.projectResources?.mcp?.format || 'opencode-json';

  function readProjectMcp(projectRoot) {
    const { servers } = getOpenCodeServers(projectRoot, relativePath, fsImpl);
    return {
      supported: true,
      path: relativePath,
      format,
      servers: Object.entries(servers).map(([id, nativeSpec]) => ({
        id,
        scope: 'project',
        server: redactSecrets(mcpFormat.convertFromOpenCodeFormat(nativeSpec)),
        enabled: nativeSpec?.enabled !== false
      }))
    };
  }

  function readProjectMcpSpec(projectRoot, id) {
    const { servers } = getOpenCodeServers(projectRoot, relativePath, fsImpl);
    if (!Object.prototype.hasOwnProperty.call(servers, id)) return null;
    return mcpFormat.convertFromOpenCodeFormat(servers[id]);
  }

  function upsertProjectMcp(projectRoot, id, spec) {
    const { config, servers, nested } = getOpenCodeServers(projectRoot, relativePath, fsImpl);
    const existing = servers[id] && typeof servers[id] === 'object' ? servers[id] : {};
    servers[id] = {
      ...existing,
      ...mcpFormat.convertToOpenCodeFormat(spec)
    };
    if (nested) config.mcp.servers = servers;
    writeJsonFileAtomic(projectRoot, relativePath, config, fsImpl);
    return {
      success: true,
      supported: true,
      path: relativePath,
      format,
      id,
      scope: 'project',
      server: redactSecrets(mcpFormat.convertFromOpenCodeFormat(servers[id])),
      enabled: servers[id].enabled !== false
    };
  }

  function removeProjectMcp(projectRoot, id) {
    const { config, servers, nested } = getOpenCodeServers(projectRoot, relativePath, fsImpl);
    const removed = Object.prototype.hasOwnProperty.call(servers, id);
    if (removed) {
      delete servers[id];
      if (nested) config.mcp.servers = servers;
      writeJsonFileAtomic(projectRoot, relativePath, config, fsImpl);
    }
    return { success: true, supported: true, path: relativePath, format, id, scope: 'project', removed };
  }

  return createProjectAdapter({
    manifest,
    fsImpl,
    mcpHandlers: { readProjectMcp, readProjectMcpSpec, upsertProjectMcp, removeProjectMcp }
  });
}

module.exports = { createAdapter };
