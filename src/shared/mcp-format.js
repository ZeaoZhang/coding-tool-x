'use strict';

const STREAMABLE_HTTP_TYPE = 'streamable_http';
const REMOTE_MCP_SERVER_TYPES = [STREAMABLE_HTTP_TYPE, 'sse'];

function copyCommonMcpFields(source, target) {
  for (const key of ['timeout', 'auth', 'oauth']) {
    if (source?.[key] !== undefined) target[key] = source[key];
  }
  return target;
}

const CODEX_PASSTHROUGH_FIELDS = [
  'enabled',
  'required',
  'enabled_tools',
  'disabled_tools',
  'startup_timeout_sec',
  'tool_timeout_sec',
  'default_tools_approval_mode',
  'tools',
  'env_vars',
  'experimental_environment',
  'bearer_token_env_var',
  'oauth'
];

function copyFields(source, target, fields) {
  for (const key of fields) {
    if (source?.[key] !== undefined) target[key] = source[key];
  }
  return target;
}

function convertToCodexFormat(spec = {}) {
  const result = { type: spec.type || 'stdio' };

  if (result.type === 'stdio') {
    result.command = spec.command || '';
    if (Array.isArray(spec.args) && spec.args.length > 0) result.args = spec.args;
    if (spec.env && Object.keys(spec.env).length > 0) result.env = spec.env;
    if (spec.cwd) result.cwd = spec.cwd;
  } else if (REMOTE_MCP_SERVER_TYPES.includes(result.type)) {
    result.url = spec.url || '';
    if (spec.headers && Object.keys(spec.headers).length > 0) result.http_headers = spec.headers;
  }

  copyFields(spec, result, CODEX_PASSTHROUGH_FIELDS);
  return result;
}

function convertFromCodexFormat(spec = {}) {
  const result = { type: spec.type || 'stdio' };

  if (result.type === 'stdio') {
    result.command = spec.command || '';
    if (spec.args) result.args = spec.args;
    if (spec.env) result.env = spec.env;
    if (spec.cwd) result.cwd = spec.cwd;
  } else if (REMOTE_MCP_SERVER_TYPES.includes(result.type)) {
    result.url = spec.url || '';
    if (spec.http_headers) result.headers = spec.http_headers;
    else if (spec.headers) result.headers = spec.headers;
  }
  copyFields(spec, result, CODEX_PASSTHROUGH_FIELDS);
  return result;
}

function extractServerSpec(spec = {}) {
  const result = { ...spec };
  for (const key of ['id', 'name', 'description', 'tags', 'homepage', 'docs', 'apps', 'createdAt', 'updatedAt']) {
    delete result[key];
  }
  return result;
}

function convertToOmpMcpFormat(spec = {}) {
  const sourceType = spec.type || 'stdio';
  let result;

  if (sourceType === 'stdio') {
    result = { type: 'stdio', command: spec.command || '' };
    if (Array.isArray(spec.args) && spec.args.length > 0) result.args = spec.args;
    if (spec.env && Object.keys(spec.env).length > 0) result.env = spec.env;
    if (spec.cwd) result.cwd = spec.cwd;
  } else if (sourceType === STREAMABLE_HTTP_TYPE) {
    result = { type: 'http', url: spec.url || '' };
    if (spec.headers && Object.keys(spec.headers).length > 0) result.headers = spec.headers;
  } else if (sourceType === 'sse') {
    result = { type: 'sse', url: spec.url || '' };
    if (spec.headers && Object.keys(spec.headers).length > 0) result.headers = spec.headers;
  } else {
    result = extractServerSpec(spec);
  }

  return copyCommonMcpFields(spec, result);
}

function convertFromOmpMcpFormat(spec = {}) {
  const sourceType = spec.type || 'stdio';
  let result;

  if (sourceType === 'stdio') {
    result = { type: 'stdio', command: spec.command || '' };
    if (spec.args) result.args = spec.args;
    if (spec.env) result.env = spec.env;
    if (spec.cwd) result.cwd = spec.cwd;
  } else if (sourceType === 'http') {
    result = { type: STREAMABLE_HTTP_TYPE, url: spec.url || '' };
    if (spec.headers) result.headers = spec.headers;
  } else if (sourceType === 'sse') {
    result = { type: 'sse', url: spec.url || '' };
    if (spec.headers) result.headers = spec.headers;
  } else {
    result = convertFromCodexFormat(spec);
  }

  return copyCommonMcpFields(spec, result);
}

function convertToOpenCodeFormat(spec = {}) {
  const sourceType = spec.type || 'stdio';

  if (sourceType === 'local' || sourceType === 'remote') {
    const result = { ...spec };
    result.enabled = spec.enabled !== false;
    if (sourceType === 'local' && typeof result.command === 'string') {
      result.command = result.command ? [result.command] : [];
    }
    return result;
  }

  if (sourceType === 'stdio') {
    const command = [];
    if (spec.command) command.push(spec.command);
    if (Array.isArray(spec.args) && spec.args.length > 0) command.push(...spec.args);

    const result = { type: 'local', command, enabled: true };
    if (spec.env && Object.keys(spec.env).length > 0) result.environment = spec.env;
    if (spec.cwd) result.cwd = spec.cwd;
    return result;
  }

  const result = { type: 'remote', url: spec.url || '', enabled: true };
  if (spec.headers && Object.keys(spec.headers).length > 0) result.headers = spec.headers;
  return result;
}

function convertFromOpenCodeFormat(spec = {}) {
  const sourceType = spec.type || (Array.isArray(spec.command) ? 'local' : 'remote');

  if (sourceType === 'local') {
    const result = { type: 'stdio' };
    if (Array.isArray(spec.command) && spec.command.length > 0) {
      result.command = spec.command[0];
      if (spec.command.length > 1) result.args = spec.command.slice(1);
    } else if (typeof spec.command === 'string') {
      result.command = spec.command;
    } else {
      result.command = '';
    }
    if (spec.environment && typeof spec.environment === 'object') result.env = spec.environment;
    else if (spec.env && typeof spec.env === 'object') result.env = spec.env;
    if (spec.cwd) result.cwd = spec.cwd;
    return result;
  }

  if (sourceType === 'remote') {
    const result = { type: STREAMABLE_HTTP_TYPE, url: spec.url || '' };
    if (spec.headers && typeof spec.headers === 'object') result.headers = spec.headers;
    return result;
  }

  if (sourceType === 'stdio' || REMOTE_MCP_SERVER_TYPES.includes(sourceType)) {
    return convertFromCodexFormat(spec);
  }

  return { type: 'stdio', command: '' };
}

module.exports = {
  extractServerSpec,
  convertToCodexFormat,
  convertFromCodexFormat,
  convertToOpenCodeFormat,
  convertFromOpenCodeFormat,
  convertToOmpMcpFormat,
  convertFromOmpMcpFormat
};
