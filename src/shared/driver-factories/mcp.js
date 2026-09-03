'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('@iarna/toml');
const tomlStringify = require('@iarna/toml').stringify;
const { ok, failed } = require('../driver-result');
const { extractServerSpec, convertToCodexFormat, convertFromCodexFormat, convertToOmpMcpFormat, convertFromOmpMcpFormat, convertToOpenCodeFormat, convertFromOpenCodeFormat } = require('../mcp-format');
const { redactSecrets, validateMcpId } = require('../project-config');

const SCHEMA_URL = 'https://raw.githubusercontent.com/can1357/oh-my-omp/main/packages/coding-agent/src/config/mcp-schema.json';

function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (inLineComment) {
      if (char === '\n') { inLineComment = false; output += char; }
      else output += ' ';
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') { inBlockComment = false; output += '  '; index += 1; }
      else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === '/' && next === '/') { inLineComment = true; output += '  '; index += 1; continue; }
    if (char === '/' && next === '*') { inBlockComment = true; output += '  '; index += 1; continue; }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, '$1');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim() ? JSON.parse(content) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readToml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return toml.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeToml(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, tomlStringify(value), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function sanitizeSpec(spec) {
  return redactSecrets(extractServerSpec(spec));
}

function normalizeSpec(spec) {
  return { ...spec, type: spec?.type || 'stdio' };
}

function createMcpDriver({ platform, ...context } = {}) {
  const { PATHS, NATIVE_PATHS } = require('../../config/paths');
  const { resolvePreferredHomeDir } = require('../../utils/home-dir');
  const home = resolvePreferredHomeDir(process.platform, process.env, os.homedir());
  const native = NATIVE_PATHS || {};
  const paths = {
    claude: native.claude?.mcp || path.join(home, '.claude.json'),
    codex: native.codex?.config,
    gemini: native.gemini?.settings || (native.gemini?.env ? path.join(path.dirname(native.gemini.env), 'settings.json') : path.join(home, '.gemini', 'settings.json')),
    opencode: native.opencode?.config,
    omp: native.omp?.mcp || path.join(native.omp?.dir || path.join(home, '.omp', 'agent'), 'mcp.json')
  };

  function selectOpenCodePath() {
    const candidates = [
      path.join(paths.opencode, 'opencode.jsonc'),
      path.join(paths.opencode, 'opencode.json'),
      path.join(paths.opencode, 'config.json')
    ];
    return candidates.find(filePath => fs.existsSync(filePath)) || candidates[1];
  }

  function readOpenCode() {
    const filePath = selectOpenCodePath();
    if (!fs.existsSync(filePath)) return { path: filePath, config: {} };
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return { path: filePath, config: JSON.parse(filePath.endsWith('.jsonc') ? stripJsonComments(raw) : raw) };
    } catch (_) {
      return { path: filePath, config: {} };
    }
  }

  function read() {
    if (platform === 'claude' || platform === 'gemini' || platform === 'omp') return readJson(paths[platform], platform === 'omp' ? { mcpServers: {} } : {});
    if (platform === 'codex') return readToml(paths.codex);
    return readOpenCode().config;
  }

  function write(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('MCP 平台配置必须是对象');
    if (platform === 'claude' || platform === 'gemini' || platform === 'omp') writeJson(paths[platform], config);
    else if (platform === 'codex') writeToml(paths.codex, config);
    else writeJson(selectOpenCodePath(), config);
    return config;
  }

  function serverMap(config) {
    const key = platform === 'codex' ? 'mcp_servers' : platform === 'opencode' ? 'mcp' : 'mcpServers';
    if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) config[key] = {};
    return config[key];
  }

  function nativeSpec(spec) {
    if (platform === 'codex') return convertToCodexFormat(spec);
    if (platform === 'opencode') return convertToOpenCodeFormat(spec);
    if (platform === 'omp') return convertToOmpMcpFormat(spec);
    return spec;
  }

  function internalSpec(spec) {
    if (platform === 'codex') return convertFromCodexFormat(spec);
    if (platform === 'opencode') return convertFromOpenCodeFormat(spec);
    if (platform === 'omp') return convertFromOmpMcpFormat(spec);
    return normalizeSpec(spec);
  }

  function sync(server) {
    if (!server?.id) throw new Error('MCP 服务器 ID 不能为空');
    if (platform === 'codex' && !fs.existsSync(paths.codex)) {
      throw new Error('Codex config.toml not found. Please run Codex CLI at least once before syncing MCP servers.');
    }
    if (platform === 'omp') validateMcpId(server.id);
    const config = read();
    const map = serverMap(config);
    map[server.id] = nativeSpec(extractServerSpec(server.server));
    if (platform === 'omp' && !config.mcpServers) config.mcpServers = map;
    write(config);
    return config;
  }

  function remove(serverId) {
    if (!serverId || !String(serverId).trim()) throw new Error('MCP 服务器 ID 不能为空');
    const config = read();
    const map = serverMap(config);
    if (Object.prototype.hasOwnProperty.call(map, serverId)) {
      delete map[serverId];
      if (platform === 'codex' && Object.keys(map).length === 0) delete config.mcp_servers;
      write(config);
    }
    return config;
  }

  function importServers(servers) {
    const config = read();
    const map = serverMap(config);
    let count = 0;
    for (const [id, spec] of Object.entries(map)) {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
      if (servers[id]) {
        servers[id].apps = { ...(servers[id].apps || {}), [platform]: true };
        count += 1;
        continue;
      }
      const now = Date.now();
      servers[id] = { id, name: id, server: internalSpec(spec), apps: { [platform]: true }, createdAt: now, updatedAt: now };
      count += 1;
    }
    return count;
  }

  function exportServers(servers) {
    const map = {};
    for (const [id, server] of Object.entries(servers || {})) {
      if (server.apps?.[platform]) map[id] = nativeSpec(sanitizeSpec(server.server));
    }
    if (platform === 'omp') return { format: 'omp', content: JSON.stringify({ $schema: SCHEMA_URL, mcpServers: map }, null, 2), contentType: 'application/json', filename: 'omp-mcp-config.json' };
    if (platform === 'opencode') return { format: 'opencode', content: JSON.stringify({ mcp: map }, null, 2), contentType: 'application/json', filename: 'opencode-mcp-config.json' };
    if (platform === 'codex') return { format: 'codex', content: tomlStringify({ mcp_servers: map }), contentType: 'application/toml', filename: 'codex-mcp-config.toml' };
    return { format: platform, content: JSON.stringify({ mcpServers: map }, null, 2), contentType: 'application/json', filename: `${platform}-mcp-config.json` };
  }

  const invoke = (operation, args) => {
    try {
      const methods = { read, write, remove, sync, import: importServers, export: exportServers, normalize: internalSpec, entries: () => Object.fromEntries(Object.entries(serverMap(read())).map(([id, spec]) => [id, internalSpec(spec)])) };
      const value = methods[operation](...args);
      const wrap = data => ok(platform, 'mcp', operation, data);
      return value && typeof value.then === 'function' ? value.then(wrap).catch(error => failed(platform, 'mcp', operation, error)) : wrap(value);
    } catch (error) {
      return failed(platform, 'mcp', operation, error);
    }
  };

  return {
    platform,
    capability: 'mcp',
    ...context,
    read: (...args) => invoke('read', args),
    write: (...args) => invoke('write', args),
    remove: (...args) => invoke('remove', args),
    sync: (...args) => invoke('sync', args),
    import: (...args) => invoke('import', args),
    export: (...args) => invoke('export', args),
    normalize: (...args) => invoke('normalize', args),
    entries: (...args) => invoke('entries', args)
  };
}

module.exports = { createMcpDriver, stripJsonComments };
