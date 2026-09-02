/**
 * MCP 服务器管理服务
 *
 * 负责 MCP 服务器的 CRUD 操作和多平台配置同步
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { McpClient, buildMissingCommandMessage, createMissingCommandHint } = require('./mcp-client');
const mcpFormat = require('../../shared/mcp-format');
const { convertToOmpMcpFormat, convertFromOmpMcpFormat } = mcpFormat;
const { PATHS } = require('../../config/paths');
const { ControlManifestStore } = require('./control-manifest-store');
const { EffectiveControlService, deriveMcpPolicy } = require('./effective-control-service');
const { validateMcpId, mergeMcpPatch, redactSecrets } = require('../../shared/project-config');

// MCP central storage path. Native paths and serialization belong to Drivers.
const MCP_SERVERS_FILE = PATHS.mcpServers;

// MCP 客户端连接池
// serverId -> { client, timestamp }
const mcpClientPool = new Map();
const POOL_TTL = 5 * 60 * 1000; // 5 minutes
const STREAMABLE_HTTP_TYPE = 'streamable_http';
const MCP_SERVER_TYPES = ['stdio', STREAMABLE_HTTP_TYPE, 'sse'];
const REMOTE_MCP_SERVER_TYPES = [STREAMABLE_HTTP_TYPE, 'sse'];
const MCP_PLATFORM_KEYS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];

const MCP_CONTROL_SERVICE = PATHS.effectiveControlManifest
  ? new EffectiveControlService({
    store: new ControlManifestStore({
      userPath: PATHS.effectiveControlManifest,
      projectPathResolver: ({ projectPath }) => path.join(projectPath, '.ctx-control.json')
    })
  })
  : null;
const OMP_MCP_SCHEMA_URL = 'https://raw.githubusercontent.com/can1357/oh-my-omp/main/packages/coding-agent/src/config/mcp-schema.json';
const OMP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/;

function normalizeServerSpec(spec = {}) {
  if (!spec || typeof spec !== 'object') {
    return spec;
  }
  const normalized = { ...spec };
  normalized.type = normalized.type || 'stdio';
  return normalized;
}

function normalizePlatformKey(platform) {
  return String(platform || '').trim().toLowerCase();
}

function getPlatformServices() {
  const { getPlatformRegistry, getPlatformRuntime } = require('../../platforms/runtime');
  return {
    registry: getPlatformRegistry(),
    runtime: getPlatformRuntime()
  };
}

function getMcpPlatformKeys() {
  const { registry } = getPlatformServices();
  const keys = [];
  const seen = new Set();

  for (const platform of registry.list()) {
    const key = normalizePlatformKey(platform.key);
    if (!key || seen.has(key)) continue;
    const driverId = registry.getCapability(key, 'mcp');
    if (!driverId || driverId === 'unsupported') continue;
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

function createPlatformCapabilityError(platform, capability, code) {
  const key = normalizePlatformKey(platform);
  const error = new Error(code === 'not_found'
    ? `无效的平台: ${key}`
    : `平台 ${key} 未声明 ${capability} capability`);
  error.status = 404;
  error.code = code;
  error.platform = key;
  error.capability = capability;
  return error;
}

function requireMcpCapability(platform) {
  const key = normalizePlatformKey(platform);
  const { registry, runtime } = getPlatformServices();
  if (!registry.resolve(key)) {
    throw createPlatformCapabilityError(key, 'mcp', 'not_found');
  }
  const driverId = registry.getCapability(key, 'mcp');
  if (!driverId || driverId === 'unsupported') {
    throw createPlatformCapabilityError(key, 'mcp', 'unsupported');
  }
  const driver = runtime.getDriver(key, 'mcp');
  if (!driver) {
    throw createPlatformCapabilityError(key, 'mcp', 'unsupported');
  }
  return { platform: key, driver };
}

// MCP 预设模板
const MCP_PRESETS = [
  {
    id: 'fetch',
    name: 'mcp-server-fetch',
    description: '获取网页内容',
    tags: ['http', 'web', 'fetch'],
    server: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch']
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch'
  },
  {
    id: 'time',
    name: '@modelcontextprotocol/server-time',
    description: '获取当前时间和时区信息',
    tags: ['time', 'utility'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-time']
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time'
  },
  {
    id: 'memory',
    name: '@modelcontextprotocol/server-memory',
    description: '知识图谱记忆存储',
    tags: ['memory', 'graph', 'knowledge'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory']
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory'
  },
  {
    id: 'sequential-thinking',
    name: '@modelcontextprotocol/server-sequential-thinking',
    description: '顺序思维推理',
    tags: ['thinking', 'reasoning'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking'
  },
  {
    id: 'filesystem',
    name: '@anthropic/mcp-server-filesystem',
    description: '文件系统读写访问',
    tags: ['filesystem', 'files'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-filesystem', '/tmp']
    },
    homepage: 'https://github.com/anthropics/anthropic-quickstarts',
    docs: 'https://github.com/anthropics/anthropic-quickstarts/tree/main/mcp-server-filesystem'
  },
  {
    id: 'context7',
    name: '@upstash/context7-mcp',
    description: '文档搜索和上下文增强',
    tags: ['docs', 'search', 'context'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp']
    },
    homepage: 'https://context7.com',
    docs: 'https://github.com/upstash/context7/blob/master/README.md'
  },
  {
    id: 'brave-search',
    name: '@anthropic/mcp-server-brave-search',
    description: 'Brave 搜索引擎',
    tags: ['search', 'web'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-brave-search'],
      env: {
        BRAVE_API_KEY: '<your-api-key>'
      }
    },
    homepage: 'https://github.com/anthropics/anthropic-quickstarts',
    docs: 'https://brave.com/search/api/'
  },
  {
    id: 'github',
    name: '@modelcontextprotocol/server-github',
    description: 'GitHub API 集成',
    tags: ['github', 'git', 'api'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: '<your-token>'
      }
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github'
  },
  {
    id: 'puppeteer',
    name: '@anthropic/mcp-server-puppeteer',
    description: '浏览器自动化',
    tags: ['browser', 'automation', 'web'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-puppeteer']
    },
    homepage: 'https://github.com/anthropics/anthropic-quickstarts',
    docs: 'https://pptr.dev/'
  },
  {
    id: 'playwright',
    name: '@anthropic/mcp-server-playwright',
    description: 'Playwright 浏览器自动化',
    tags: ['browser', 'automation', 'testing'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-playwright']
    },
    homepage: 'https://github.com/anthropics/anthropic-quickstarts',
    docs: 'https://playwright.dev/'
  },
  {
    id: 'sqlite',
    name: '@anthropic/mcp-server-sqlite',
    description: 'SQLite 数据库访问',
    tags: ['database', 'sql', 'sqlite'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-sqlite', '--db-path', '/path/to/database.db']
    },
    homepage: 'https://github.com/anthropics/anthropic-quickstarts',
    docs: 'https://www.sqlite.org/docs.html'
  },
  {
    id: 'postgres',
    name: '@anthropic/mcp-server-postgres',
    description: 'PostgreSQL 数据库访问',
    tags: ['database', 'sql', 'postgres'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-postgres'],
      env: {
        POSTGRES_CONNECTION_STRING: 'postgresql://user:pass@localhost:5432/db'
      }
    },
    homepage: 'https://github.com/anthropics/anthropic-quickstarts',
    docs: 'https://www.postgresql.org/docs/'
  },
  {
    id: 'slack',
    name: '@modelcontextprotocol/server-slack',
    description: 'Slack 消息和频道访问',
    tags: ['slack', 'chat', 'messaging'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {
        SLACK_BOT_TOKEN: '<your-bot-token>',
        SLACK_TEAM_ID: '<your-team-id>'
      }
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://api.slack.com/docs'
  },
  {
    id: 'google-drive',
    name: '@modelcontextprotocol/server-gdrive',
    description: 'Google Drive 文件访问',
    tags: ['google', 'drive', 'files'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive']
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://developers.google.com/drive'
  },
  {
    id: 'everart',
    name: '@modelcontextprotocol/server-everart',
    description: 'AI 图片生成',
    tags: ['image', 'art', 'generation'],
    server: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everart'],
      env: {
        EVERART_API_KEY: '<your-api-key>'
      }
    },
    homepage: 'https://github.com/modelcontextprotocol/servers',
    docs: 'https://everart.ai/docs'
  }
];

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 安全读取 JSON 文件
 */
function readJsonFile(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`[MCP] Failed to read ${filePath}:`, sanitizeMcpErrorText(err.message || err));
  }
  return defaultValue;
}
function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}


function getPathEnvKey(envObj = {}) {
  return Object.keys(envObj).find(key => key.toLowerCase() === 'path') || 'PATH';
}

function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function mergeSpawnEnv(extraEnv = {}) {
  const mergedEnv = { ...process.env, ...extraEnv };
  const processPathKey = getPathEnvKey(process.env);
  const extraPathKey = getPathEnvKey(extraEnv);
  const mergedPathKey = getPathEnvKey(mergedEnv);

  const extraPath = extraEnv && typeof extraEnv[extraPathKey] === 'string'
    ? extraEnv[extraPathKey]
    : '';
  const processPath = process.env && typeof process.env[processPathKey] === 'string'
    ? process.env[processPathKey]
    : '';

  if (extraPath && processPath) {
    mergedEnv[mergedPathKey] = `${extraPath}${path.delimiter}${processPath}`;
  }

  return mergedEnv;
}

function resolveWindowsSpawnCommand(command, env, cwd) {
  if (process.platform !== 'win32') {
    return stripWrappingQuotes(command);
  }

  const normalizedCommand = stripWrappingQuotes(command);
  if (!normalizedCommand) {
    return normalizedCommand;
  }

  const hasPathSegment = /[\\/]/.test(normalizedCommand) || /^[a-zA-Z]:/.test(normalizedCommand);
  const hasExtension = path.extname(normalizedCommand).length > 0;
  const extensions = hasExtension ? [''] : ['.cmd', '.exe', '.bat', '.com'];
  const resolveCandidate = (basePath) => {
    for (const ext of extensions) {
      const candidate = ext ? `${basePath}${ext}` : basePath;
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  if (hasPathSegment) {
    const absoluteBasePath = path.isAbsolute(normalizedCommand)
      ? normalizedCommand
      : path.resolve(cwd || process.cwd(), normalizedCommand);
    return resolveCandidate(absoluteBasePath) || normalizedCommand;
  }

  const pathKey = getPathEnvKey(env || process.env);
  const pathValue = env && typeof env[pathKey] === 'string' ? env[pathKey] : '';
  if (!pathValue) {
    return normalizedCommand;
  }

  const searchPaths = pathValue.split(path.delimiter).filter(Boolean);
  for (const searchPath of searchPaths) {
    const found = resolveCandidate(path.join(searchPath.trim(), normalizedCommand));
    if (found) {
      return found;
    }
  }

  return normalizedCommand;
}

function extractMcpHint(error) {
  return error?.data?.hint || error?.hint || null;
}

function sanitizeMcpErrorText(value) {
  return String(value || '')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, '$1?[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|secret|password|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|api[-_]?key|authorization)\s*[:=]\s*)[^,\s}]+/gi, '$1[REDACTED]');
}

const SENSITIVE_MCP_HINT_KEYS = /(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|headers?|env(?:ironment)?|envvars|experimentalenvironment|auth|oauth|credential|private[_-]?key)/i;

function sanitizeMcpHint(value) {
  if (Array.isArray(value)) {
    const sanitized = value.map(sanitizeMcpHint);
    return sanitized.every((item, index) => item === value[index]) ? value : sanitized;
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeCommandLineValue(value) : value;
  }
  let changed = false;
  const sanitized = Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const safe = SENSITIVE_MCP_HINT_KEYS.test(key)
      ? '[REDACTED]'
      : sanitizeMcpHint(child);
    if (safe !== child) changed = true;
    return [key, safe];
  }));
  return changed ? sanitized : value;
}

const SENSITIVE_MCP_RESULT_KEYS = /(?:token|secret|password|authorization|api[-_]?key|access[_-]?token|credential|private[_-]?key|env(?:ironment)?|envvars|experimentalenvironment|headers?|auth|oauth)/i;

const SENSITIVE_COMMAND_FLAG = /^(?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)$/i;

function sanitizeCommandLineValue(value) {
  if (Array.isArray(value)) {
    let redactNext = false;
    return value.map(item => {
      if (redactNext) {
        redactNext = false;
        return '[REDACTED]';
      }
      if (typeof item !== 'string') return '[REDACTED]';
      if (SENSITIVE_COMMAND_FLAG.test(item)) {
        redactNext = true;
        return item;
      }
      const inline = item.match(/^((?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)=).*/i);
      if (inline) return `${inline[1]}[REDACTED]`;
      return sanitizeMcpErrorText(item);
    });
  }
  if (typeof value !== 'string') return value;
  return sanitizeMcpErrorText(value)
    .replace(/((?:^|\s)(?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)(?:=|\s+))\S+/gi, '$1[REDACTED]');
}


function sanitizeMcpToolValue(value, key = '') {
  if (SENSITIVE_MCP_RESULT_KEYS.test(String(key))) return '[REDACTED]';
  if (/^(?:command|args)$/i.test(key)) return sanitizeCommandLineValue(value);
  if (typeof value === 'string') return sanitizeMcpErrorText(value);
  if (Array.isArray(value)) return value.map(item => sanitizeMcpToolValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    sanitizeMcpToolValue(childValue, childKey)
  ]));
}

function buildMcpFailureResult(error, fallbackMessage, duration) {
  const hint = sanitizeMcpHint(extractMcpHint(error));
  return {
    message: sanitizeMcpErrorText(hint?.title || fallbackMessage || error?.message || '操作失败'),
    hint,
    duration
  };
}

// ============================================================================
// MCP 数据管理
// ============================================================================

function normalizeServerApps(apps = {}, fallbackApps = { claude: true }) {
  const source = apps && typeof apps === 'object' && !Array.isArray(apps) ? apps : {};
  const fallback = fallbackApps && typeof fallbackApps === 'object' && !Array.isArray(fallbackApps)
    ? fallbackApps
    : {};
  const platformKeys = new Set(getMcpPlatformKeys());
  const normalized = {};

  for (const platform of platformKeys) {
    normalized[platform] = source[platform] !== undefined
      ? !!source[platform]
      : !!fallback[platform];
  }

  // Preserve historical flags for platforms that are temporarily absent from the
  // current registry so disabling/re-enabling a Manifest does not erase data.
  for (const [platform, enabled] of Object.entries(source)) {
    if (!platformKeys.has(platform)) normalized[platform] = !!enabled;
  }

  for (const [platform, enabled] of Object.entries(fallback)) {
    if (!platformKeys.has(platform) && source[platform] === undefined) {
      normalized[platform] = !!enabled;
    }
  }

  return normalized;
}

function getControlMcpPlatformKeys() {
  const dynamic = getMcpPlatformKeys();
  return dynamic.length > 0 ? dynamic : MCP_PLATFORM_KEYS;
}
function mcpControlKey(platform, serverId, scope = 'user') {
  return `mcp:${platform}:${scope}:${serverId}`;
}

function secretRefsForServer(server = {}) {
  const refs = [];
  for (const key of Object.keys(server.server?.env || {})) refs.push(`env:${key}`);
  for (const key of Object.keys(server.server?.headers || {})) refs.push(`header:${key}`);
  if (server.server?.url) refs.push('url:configured');
  return refs;
}

function ensureMcpControlEntry(server, platform) {
  if (!MCP_CONTROL_SERVICE || !server?.id) return null;
  const controlKey = mcpControlKey(platform, server.id);
  const existing = MCP_CONTROL_SERVICE.getMcp(controlKey, { scope: 'user' });
  const policy = deriveMcpPolicy({ transport: server.server?.type, scope: 'user' });
  if (existing) {
    const secretRefs = secretRefsForServer(server);
    if (
      existing.transport !== policy.transport
      || existing.riskTier !== policy.riskTier
      || existing.egressProfile !== policy.egressProfile
      || !existing.source
      || JSON.stringify(existing.secretRefs || []) !== JSON.stringify(secretRefs)
    ) {
      return MCP_CONTROL_SERVICE.registerMcp({
        ...existing,
        ...policy,
        source: existing.source || 'catalog',
        secretRefs
      });
    }
    return existing;
  }
  return MCP_CONTROL_SERVICE.registerMcp({
    kind: 'mcp',
    controlKey,
    platform,
    scope: 'user',
    name: server.id,
    source: 'catalog',
    enabled: server.apps?.[platform] === true,
    trust: 'approved',
    ...policy,
    secretRefs: secretRefsForServer(server),
    managed: true
  });
}

function promoteMcpControlEntry(server, platform, enabled) {
  if (!MCP_CONTROL_SERVICE || !server?.id) return null;
  const controlKey = mcpControlKey(platform, server.id);
  const existing = MCP_CONTROL_SERVICE.getMcp(controlKey, { scope: 'user' });
  if (!existing) {
    return ensureMcpControlEntry(server, platform);
  }
  if (existing.managed !== true) {
    return MCP_CONTROL_SERVICE.registerMcp({
      ...existing,
      ...deriveMcpPolicy({ transport: server.server?.type, scope: 'user' }),
      source: 'catalog',
      enabled: enabled === true,
      trust: 'approved',
      secretRefs: secretRefsForServer(server),
      managed: true
    });
  }
  ensureMcpControlEntry(server, platform);
  return MCP_CONTROL_SERVICE.setMcpPolicy({
    platform,
    controlKey,
    scope: 'user',
    enabled: enabled === true
  });
}

function getMcpControlEnabled(server, platform) {
  const entry = ensureMcpControlEntry(server, platform);
  return entry
    ? entry.managed === true && entry.trust === 'approved' && entry.enabled === true
    : server.apps?.[platform] === true;
}

function applyMcpControlApps(server) {
  if (!MCP_CONTROL_SERVICE || !server?.id) return;
  for (const platform of getControlMcpPlatformKeys()) {
    const controlKey = mcpControlKey(platform, server.id);
    const existing = MCP_CONTROL_SERVICE.getMcp(controlKey, { scope: 'user' });
    if (!existing) {
      ensureMcpControlEntry(server, platform);
      continue;
    }
    if (existing.managed !== true) {
      promoteMcpControlEntry(server, platform, server.apps?.[platform] === true);
      continue;
    }
    MCP_CONTROL_SERVICE.setMcpPolicy({
      platform,
      controlKey,
      scope: 'user',
      enabled: server.apps?.[platform] === true
    });
  }
}

function readNativeMcpEntries() {
  const entries = [];
  for (const platform of getMcpPlatformKeys()) {
    try {
      const { driver } = requireMcpCapability(platform);
      const result = driver.entries ? driver.entries() : driver.read?.();
      if (result && typeof result.then === 'function') continue;
      const config = result?.status === 'ok' ? result.data : result;
      const nativeEntries = driver.entries
        ? config
        : getGenericMcpServerMap(config || {});
      for (const [rawId, spec] of Object.entries(nativeEntries || {})) {
        let id;
        try {
          id = validateMcpId(rawId);
        } catch {
          console.warn(`[MCP] Ignoring invalid native server id for ${platform}`);
          continue;
        }
        const normalized = driver.normalize ? driver.normalize(spec) : normalizeServerSpec(spec);
        const internalSpec = normalized?.status === 'ok' ? normalized.data : normalized;
        entries.push({ platform, id, spec: internalSpec });
      }
    } catch {
      // A missing or malformed native config must not block central inventory.
    }
  }
  return entries;
}

function ensureExternalNativeMcpControl(platform, id, spec) {
  if (!MCP_CONTROL_SERVICE) return null;
  const controlKey = mcpControlKey(platform, id);
  const existing = MCP_CONTROL_SERVICE.getMcp(controlKey, { scope: 'user' });
  if (existing) return existing;
  return MCP_CONTROL_SERVICE.registerMcp({
    kind: 'mcp',
    controlKey,
    platform,
    scope: 'user',
    name: id,
    source: 'native',
    enabled: false,
    trust: 'approved',
    ...deriveMcpPolicy({ transport: spec?.type, scope: 'user' }),
    secretRefs: secretRefsForServer({ server: spec }),
    managed: false
  });
}

/**
 * 获取所有 MCP 服务器
 */
function getAllServers() {
  const persisted = readJsonFile(MCP_SERVERS_FILE, {});
  const servers = {};

  for (const [rawId, server] of Object.entries(persisted)) {
    const normalizedId = validateMcpId(server?.id || rawId);
    if (!server || typeof server !== 'object' || Array.isArray(server)) {
      continue;
    }
    server.id = normalizedId;
    server.apps = server.apps == null
      ? normalizeServerApps(server.apps)
      : normalizeServerApps(server.apps, {});
    server.server = normalizeServerSpec(server.server);
    for (const platform of getControlMcpPlatformKeys()) {
      server.apps[platform] = getMcpControlEnabled(server, platform);
    }
    servers[normalizedId] = server;
  }

  for (const entry of readNativeMcpEntries()) {
    if (!servers[entry.id]) {
      ensureExternalNativeMcpControl(entry.platform, entry.id, entry.spec);
    }
  }
  return servers;
}

/**
 * 获取单个 MCP 服务器
 */
function getServer(id) {
  const normalizedId = validateMcpId(id);
  const servers = getAllServers();
  return servers[normalizedId] || null;
}

/**
 * 保存 MCP 服务器（添加或更新）
 */
async function saveServer(server, options = {}) {
  const { syncPlatforms = true } = options;
  if (!server || typeof server !== 'object') {
    throw new Error('MCP server must be an object');
  }
  server.id = validateMcpId(server.id);
  const incomingSpec = normalizeServerSpec(server.server);
  const servers = getAllServers();
  const existingServer = servers[server.id];
  server.server = existingServer
    ? mergeMcpPatch(existingServer.server, incomingSpec)
    : incomingSpec;

  // 验证服务器配置
  validateServerSpec(server.server);
  const previousApps = existingServer ? normalizeServerApps(existingServer.apps) : null;

  // 如果是新服务器，设置默认值
  if (!existingServer) {
    server.createdAt = Date.now();
  } else {
    server.createdAt = existingServer.createdAt || server.createdAt || Date.now();
  }
  server.updatedAt = Date.now();

  // Ensure apps is present while preserving existing flags.
  if (!server.apps) {
    server.apps = previousApps
      ? normalizeServerApps(previousApps)
      : normalizeServerApps({ claude: true });
  } else {
    server.apps = normalizeServerApps(server.apps, previousApps || {});
  }

  if (MCP_CONTROL_SERVICE) {
    const requestedApps = normalizeServerApps(server.apps);
    const effectiveApps = { ...requestedApps };
    for (const platform of getControlMcpPlatformKeys()) {
      const control = promoteMcpControlEntry({ ...server, apps: requestedApps }, platform, requestedApps[platform]);
      effectiveApps[platform] = control
        ? control.managed === true && control.trust === 'approved' && control.enabled === true
        : requestedApps[platform];
    }
    server.apps = effectiveApps;
  }
  if (syncPlatforms) {
    await syncServerToAllPlatforms(server, previousApps);
  }

  servers[server.id] = server;
  writeJsonFile(MCP_SERVERS_FILE, servers);
  applyMcpControlApps(server);

  return server;
}

/**
 * 删除 MCP 服务器
 */
async function deleteServer(id) {
  const normalizedId = validateMcpId(id);
  const servers = getAllServers();
  const server = servers[normalizedId];

  if (!server) {
    return false;
  }

  await removeServerFromAllPlatforms(normalizedId);
  delete servers[normalizedId];
  writeJsonFile(MCP_SERVERS_FILE, servers);
  for (const platform of getControlMcpPlatformKeys()) {
    MCP_CONTROL_SERVICE?.removeMcp?.({
      controlKey: mcpControlKey(platform, normalizedId),
      scope: 'user'
    });
  }

  return true;
}

/**
 * 切换 MCP 服务器在某平台的启用状态
 */
async function toggleServerApp(serverId, app, enabled) {
  const normalizedId = validateMcpId(serverId);
  const servers = getAllServers();
  const server = servers[normalizedId];

  if (!server) {
    throw new Error(`MCP 服务器 "${serverId}" 不存在`);
  }

  const { platform: normalizedPlatform } = requireMcpCapability(app);

  const policy = MCP_CONTROL_SERVICE
    ? MCP_CONTROL_SERVICE.setMcpPolicy({
      platform: normalizedPlatform,
      controlKey: mcpControlKey(normalizedPlatform, normalizedId),
      scope: 'user',
      enabled: enabled === true
    })
    : { enabled: enabled === true };
  if (policy.status === 'needs_approval' || policy.status === 'blocked') {
    return { ...server, apps: { ...server.apps, [normalizedPlatform]: policy.enabled === true }, status: policy.status };
  }

  server.apps = normalizeServerApps(server.apps);
  server.apps[normalizedPlatform] = policy.enabled === true;
  server.updatedAt = Date.now();

  // Sync to the selected platform.
  if (server.apps[normalizedPlatform]) {
    await syncServerToPlatform(server, normalizedPlatform);
  } else {
    await removeServerFromPlatform(normalizedId, normalizedPlatform);
  }

  writeJsonFile(MCP_SERVERS_FILE, servers);

  return server;
}

/**
 * 获取 MCP 预设模板列表
 */
function getPresets() {
  return MCP_PRESETS;
}

// ============================================================================
// 服务器配置验证
// ============================================================================

/**
 * 验证 MCP 服务器配置
 */
function validateServerSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('服务器配置必须是对象');
  }

  const type = spec.type || 'stdio';

  if (!MCP_SERVER_TYPES.includes(type)) {
    throw new Error(`无效的服务器类型: ${spec.type || type}，必须是 stdio、streamable_http 或 sse`);
  }
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some(arg => typeof arg !== 'string'))) {
    throw new Error('MCP server args must be an array of strings');
  }

  if (type === 'stdio') {
    if (typeof spec.command !== 'string' || !spec.command.trim()) {
      throw new Error('stdio 类型必须指定 string command');
    }
  } else if (REMOTE_MCP_SERVER_TYPES.includes(type)) {
    if (typeof spec.url !== 'string' || !spec.url.trim()) {
      throw new Error(`${type} 类型必须指定 string url`);
    }
  }
}

// ============================================================================
// 平台配置同步
// ============================================================================

/**
 * 同步服务器到所有已启用的平台
 */
async function syncServerToAllPlatforms(server, previousApps = null) {
  const { apps } = server;
  const previous = previousApps ? normalizeServerApps(previousApps) : null;

  const shouldRemoveFromPlatform = (platform) => {
    // For new servers we should not delete existing platform config implicitly.
    if (!previous) return false;
    return previous[platform] && !apps[platform];
  };

  for (const platform of getMcpPlatformKeys()) {
    if (apps[platform]) {
      await syncServerToPlatform(server, platform);
    } else if (shouldRemoveFromPlatform(platform)) {
      await removeServerFromPlatform(server.id, platform);
    }
  }
}

/**
 * 从所有平台移除服务器
 */
async function removeServerFromAllPlatforms(serverId) {
  for (const platform of getMcpPlatformKeys()) {
    const control = MCP_CONTROL_SERVICE?.getMcp?.(
      mcpControlKey(platform, serverId),
      { scope: 'user' }
    );
    if (control && control.managed !== true) continue;
    await removeServerFromPlatform(serverId, platform);
  }
}

/**
 * 同步服务器到指定平台
 */
async function syncServerToPlatform(server, platform) {
  try {
    const { platform: normalizedPlatform, driver } = requireMcpCapability(platform);
    let result;
    if (typeof driver.sync === 'function') {
      result = await driver.sync(server);
    } else {
      result = await syncGenericMcpServer(driver, normalizedPlatform, server);
    }
    const failure = getDriverFailure(result, normalizedPlatform, 'sync');
    if (failure) throw failure;
    console.log(`[MCP] Synced "${server.id}" to ${normalizedPlatform}`);
    return result;
  } catch (err) {
    console.error(`[MCP] Failed to sync "${server.id}" to ${platform}:`, sanitizeMcpErrorText(err.message || err));
    throw err;
  }
}

async function removeServerFromPlatform(serverId, platform) {
  try {
    const { platform: normalizedPlatform, driver } = requireMcpCapability(platform);
    let result;
    if (typeof driver.remove === 'function') {
      result = await driver.remove(serverId);
    } else {
      result = await removeGenericMcpServer(driver, normalizedPlatform, serverId);
    }
    const failure = getDriverFailure(result, normalizedPlatform, 'remove');
    if (failure) throw failure;
    console.log(`[MCP] Removed "${serverId}" from ${normalizedPlatform}`);
    return result;
  } catch (err) {
    console.error(`[MCP] Failed to remove "${serverId}" from ${platform}:`, sanitizeMcpErrorText(err.message || err));
    throw err;
  }
}

function getDriverFailure(result, platform, operation) {
  if (!result || result.status !== 'failed' || result.capability !== 'mcp') return null;
  if (result.cause instanceof Error) return result.cause;
  return new Error(result.error || `MCP ${operation} failed for ${platform}`);
}

async function readGenericMcpConfig(driver, platform, allowMissing = false) {
  const result = await driver.read();
  const failure = getDriverFailure(result, platform, 'read');
  if (failure) {
    if (allowMissing && failure.code === 'ENOENT') return {};
    throw failure;
  }
  const config = result?.status === 'ok' ? result.data : result;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`MCP 配置必须是 JSON 对象: ${platform}`);
  }
  return config;
}

async function writeGenericMcpConfig(driver, platform, config) {
  const result = await driver.write(config);
  const failure = getDriverFailure(result, platform, 'write');
  if (failure) throw failure;
  return result?.status === 'ok' ? result.data : result;
}

function invokeMcpDriver(platform, operation, args = []) {
  const { driver } = requireMcpCapability(platform);
  if (typeof driver[operation] !== 'function') {
    const error = createPlatformCapabilityError(platform, 'mcp', 'unsupported');
    error.operation = operation;
    throw error;
  }
  const normalize = result => {
    const failure = getDriverFailure(result, platform, operation);
    if (failure) throw failure;
    return result?.status === 'ok' ? result.data : result;
  };
  const result = driver[operation](...args);
  return result && typeof result.then === 'function' ? result.then(normalize) : normalize(result);
}

function readPlatformMcpConfig(platform) {
  return invokeMcpDriver(platform, 'read');
}

function writePlatformMcpConfig(platform, config) {
  return invokeMcpDriver(platform, 'write', [config]);
}

function removePlatformMcpServer(platform, serverId) {
  return invokeMcpDriver(platform, 'remove', [serverId]);
}

function syncPlatformMcpServer(platform, server) {
  return invokeMcpDriver(platform, 'sync', [server]);
}

function importPlatformMcpServers(platform, servers) {
  return invokeMcpDriver(platform, 'import', [servers]);
}

function exportPlatformMcpServers(platform, servers) {
  return invokeMcpDriver(platform, 'export', [servers]);
}

function getGenericMcpServerMap(config) {
  for (const key of ['mcpServers', 'mcp_servers', 'mcp']) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue;
    if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) {
      throw new Error(`MCP 配置 ${key} 必须是对象`);
    }
    return config[key];
  }
  return config;
}

async function syncGenericMcpServer(driver, platform, server) {
  const config = await readGenericMcpConfig(driver, platform, true);
  const mcpServers = getGenericMcpServerMap(config);
  mcpServers[server.id] = extractServerSpec(server.server);
  return writeGenericMcpConfig(driver, platform, config);
}

async function removeGenericMcpServer(driver, platform, serverId) {
  const config = await readGenericMcpConfig(driver, platform, true);
  const mcpServers = getGenericMcpServerMap(config);
  if (!Object.prototype.hasOwnProperty.call(mcpServers, serverId)) return config;
  delete mcpServers[serverId];
  return writeGenericMcpConfig(driver, platform, config);
}

async function importGenericMcpServers(driver, platform, servers) {
  const config = await readGenericMcpConfig(driver, platform, true);
  const mcpServers = getGenericMcpServerMap(config);
  let count = 0;

  for (const [id, spec] of Object.entries(mcpServers)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    if (servers[id]) {
      servers[id].apps = normalizeServerApps(servers[id].apps, {});
      if (!servers[id].apps[platform]) {
        servers[id].apps[platform] = true;
        count++;
      }
      continue;
    }

    const now = Date.now();
    servers[id] = {
      id,
      name: id,
      server: normalizeServerSpec(spec),
      apps: { [platform]: true },
      createdAt: now,
      updatedAt: now
    };
    count++;
  }

  return count;
}


// ============================================================================
// 导入功能
// ============================================================================

/**
 * 从指定平台导入 MCP 配置
 */
async function importFromPlatform(platform) {
  const { platform: normalizedPlatform, driver } = requireMcpCapability(platform);
  const servers = getAllServers();
  const result = typeof driver.import === 'function'
    ? await driver.import(servers)
    : await importGenericMcpServers(driver, normalizedPlatform, servers);
  const failure = getDriverFailure(result, normalizedPlatform, 'import');
  if (failure) throw failure;
  const importedCount = result?.status === 'ok' ? result.data : result;

  if (importedCount > 0) {
    writeJsonFile(MCP_SERVERS_FILE, servers);
    for (const server of Object.values(servers)) {
      applyMcpControlApps(server);
    }
  }
  return importedCount;
}



/**
 * 提取纯净的服务器规范（移除元数据）
 */
function extractServerSpec(spec) {
  return mcpFormat.extractServerSpec(spec);
}

const EXPORT_SECRET_KEY_PATTERN = /(?:token|secret|password|authorization|api[-_]?key|access[_-]?token|credential|private[_-]?key|secretrefs?|auth|oauth|envvars|experimentalenvironment)/i;

function sanitizeExportValue(value, key = '') {
  if (/^url$/i.test(key)) return typeof value === 'string' ? redactSecrets({ url: value }).url : value;
  if (/^(?:auth|oauth|bearer_token_env_var|secretRefs?)$/i.test(key) || EXPORT_SECRET_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  if (/^(?:command|args)$/i.test(key)) return sanitizeCommandLineValue(value);
  if (typeof value === 'string') return sanitizeMcpErrorText(value);
  if (/^(?:env|environment|env_vars|experimental_environment)$/i.test(key)) {
    if (Array.isArray(value)) {
      return value.map(item => (
        typeof item === 'string' && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(item)
          ? item
          : '[REDACTED]'
      ));
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        typeof childValue === 'string' && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(childValue)
          ? childValue
          : '[REDACTED]'
      ]));
    }
    return '[REDACTED]';
  }
  if (/^(?:headers|http_headers)$/i.test(key) && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([header, headerValue]) => [
      header,
      /^(?:accept|content-type|user-agent)$/i.test(header) ? headerValue : '[REDACTED]'
    ]));
  }
  if (Array.isArray(value)) return value.map(item => sanitizeExportValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    sanitizeExportValue(childValue, childKey)
  ]));
}

function sanitizeExportSpec(spec = {}) {
  return sanitizeExportValue(extractServerSpec(spec));
}

/**
 * 获取统计信息
 */
function getStats() {
  const servers = getAllServers();
  const serverList = Object.values(servers);
  const stats = { total: serverList.length };

  for (const platform of getMcpPlatformKeys()) {
    stats[platform] = serverList.filter(server => server.apps?.[platform]).length;
  }

  return stats;
}

// ============================================================================
// 服务器测试功能
// ============================================================================

/**
 * 测试 MCP 服务器连接
 * @param {string} serverId - 服务器 ID
 * @returns {Promise<{success: boolean, message: string, duration?: number}>}
 */
async function testServer(serverId) {
  const server = getServer(serverId);
  if (!server) {
    throw new Error(`MCP 服务器 "${serverId}" 不存在`);
  }
  assertMcpServerActivated(server);

  const spec = server.server;
  const type = spec.type || 'stdio';
  const startTime = Date.now();

  try {
    if (type === 'stdio') {
      return await testStdioServer(spec);
    } else if (REMOTE_MCP_SERVER_TYPES.includes(type)) {
      return await testHttpServer(spec);
    } else {
      return { success: false, message: `不支持的服务器类型: ${type}` };
    }
  } catch (err) {
    const failure = buildMcpFailureResult(err, err.message, Date.now() - startTime);
    return {
      success: false,
      message: failure.message,
      hint: failure.hint,
      duration: failure.duration
    };
  }
}

/**
 * 测试 stdio 类型服务器
 */
async function testStdioServer(spec) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const timeout = 10000; // 10 秒超时

    // 检查命令是否存在
    const command = spec.command;
    const args = spec.args || [];
    const cwd = spec.cwd || process.cwd();
    const mergedEnv = mergeSpawnEnv(spec.env || {});
    const resolvedCommand = resolveWindowsSpawnCommand(command, mergedEnv, cwd);

    let child;
    let resolved = false;
    let stdout = '';
    let stderr = '';

    const cleanup = () => {
      if (child && !child.killed) {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 1000);
      }
    };

    const done = (result) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    try {
      child = spawn(resolvedCommand, args, {
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        windowsHide: true
      });

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        // MCP 服务器启动成功通常会输出 JSON-RPC 相关内容
        if (stdout.includes('{') || stdout.length > 0) {
          done({
            success: true,
            message: '服务器启动成功',
            duration: Date.now() - startTime
          });
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        if (err.code === 'ENOENT') {
          const hint = createMissingCommandHint(command, resolvedCommand, mergedEnv);
          done({
            success: false,
            message: buildMissingCommandMessage(command, resolvedCommand, mergedEnv),
            hint,
            duration: Date.now() - startTime
          });
        } else {
          done({
            success: false,
            message: sanitizeMcpErrorText(`启动失败: ${err.message}`),
            duration: Date.now() - startTime
          });
        }
      });

      child.on('close', (code) => {
        if (code === 0 || stdout.length > 0) {
          done({
            success: true,
            message: '服务器测试通过',
            duration: Date.now() - startTime
          });
        } else {
          done({
            success: false,
            message: sanitizeMcpErrorText(stderr || `进程退出码: ${code}`),
            duration: Date.now() - startTime
          });
        }
      });

      // 超时处理
      setTimeout(() => {
        // 如果进程还在运行，说明服务器正常启动了
        if (!resolved && child && !child.killed) {
          done({
            success: true,
            message: '服务器正常运行中',
            duration: Date.now() - startTime
          });
        }
      }, 3000); // 3 秒后如果还在运行就认为成功

      // 最终超时
      setTimeout(() => {
        done({
          success: false,
          message: '测试超时',
          duration: timeout
        });
      }, timeout);

    } catch (err) {
      const failure = buildMcpFailureResult(err, `测试失败: ${err.message}`, Date.now() - startTime);
      done({
        success: false,
        message: failure.message,
        hint: failure.hint,
        duration: failure.duration
      });
    }
  });
}

/**
 * 测试 streamable_http/sse 类型服务器
 */
async function testHttpServer(spec) {
  const startTime = Date.now();
  let client = null;

  try {
    client = new McpClient(spec, { timeout: 10000 });
    await client.connect();
    await client.initialize();

    return {
      success: true,
      message: '服务器 MCP 握手成功',
      duration: Date.now() - startTime
    };
  } catch (err) {
    const failure = buildMcpFailureResult(err, err.message, Date.now() - startTime);
    return {
      success: false,
      message: failure.message,
      hint: failure.hint,
      duration: failure.duration
    };
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch (err) {
        // ignore cleanup failures
      }
    }
  }
}

function assertMcpServerActivated(server) {
  if (getControlMcpPlatformKeys().some(platform => server.apps?.[platform] === true)) return;
  const error = new Error('MCP server is disabled by the effective control policy');
  error.code = 'MCP_DISABLED';
  throw error;
}

/**
 * Get tools list from MCP server
 * @param {string} serverId - Server ID from config
 * @returns {Promise<{tools: Array, duration: number, status: string}>}
 */
async function getServerTools(serverId) {
  const server = getServer(serverId);
  if (!server) {
    throw new Error(`MCP 服务器 "${serverId}" 不存在`);
  }
  assertMcpServerActivated(server);

  const startTime = Date.now();
  const spec = server.server;

  try {
    // Check if we have a cached connection
    const cached = mcpClientPool.get(serverId);
    const now = Date.now();

    let client;
    let needsInitialization = false;

    if (cached && now - cached.timestamp < POOL_TTL && cached.client.connected) {
      // Reuse existing connection
      client = cached.client;
      console.log(`[MCP] Reusing pooled connection for "${serverId}"`);
    } else {
      // Create new connection
      if (cached) {
        // Clean up expired connection
        try {
          await cached.client.disconnect();
        } catch (err) {
          console.error(`[MCP] Error disconnecting expired client: ${sanitizeMcpErrorText(err.message || err)}`);
        }
        mcpClientPool.delete(serverId);
      }

      // Create new client with 10s timeout
      client = new McpClient(spec, { timeout: 10000 });
      needsInitialization = true;
      console.log(`[MCP] Creating new connection for "${serverId}"`);
    }

    // Connect and initialize if needed
    if (needsInitialization) {
      await client.connect();
      await client.initialize();

      // Cache the connection
      mcpClientPool.set(serverId, {
        client,
        timestamp: Date.now()
      });
    }

    // Get tools list
    const tools = sanitizeMcpToolValue(await client.listTools());

    return {
      tools,
      duration: Date.now() - startTime,
      status: 'online'
    };

  } catch (err) {
    // Clean up failed connection from pool
    const cached = mcpClientPool.get(serverId);
    if (cached) {
      try {
        await cached.client.disconnect();
      } catch (e) {
        // ignore
      }
      mcpClientPool.delete(serverId);
    }

    const failure = buildMcpFailureResult(err, err.message, Date.now() - startTime);
    return {
      tools: [],
      duration: failure.duration,
      status: 'error',
      error: failure.message,
      message: failure.message,
      hint: failure.hint
    };
  }
}

/**
 * Execute a tool on MCP server
 * @param {string} serverId - Server ID
 * @param {string} toolName - Tool name
 * @param {Object} arguments - Tool arguments
 * @returns {Promise<{result: Object, duration: number, isError: boolean, truncated?: boolean, truncatedSize?: number}>}
 */
async function callServerTool(serverId, toolName, arguments = {}) {
  const server = getServer(serverId);
  if (!server) {
    throw new Error(`MCP 服务器 "${serverId}" 不存在`);
  }
  assertMcpServerActivated(server);

  const startTime = Date.now();
  const spec = server.server;

  try {
    // Check if we have a cached connection
    const cached = mcpClientPool.get(serverId);
    const now = Date.now();

    let client;
    let needsInitialization = false;

    if (cached && now - cached.timestamp < POOL_TTL && cached.client.connected) {
      // Reuse existing connection
      client = cached.client;
      // Update timestamp
      cached.timestamp = now;
      console.log(`[MCP] Reusing pooled connection for "${serverId}"`);
    } else {
      // Create new connection
      if (cached) {
        // Clean up expired connection
        try {
          await cached.client.disconnect();
        } catch (err) {
          console.error(`[MCP] Error disconnecting expired client: ${sanitizeMcpErrorText(err.message || err)}`);
        }
        mcpClientPool.delete(serverId);
      }

      // Create new client with 30s timeout
      client = new McpClient(spec, { timeout: 30000 });
      needsInitialization = true;
      console.log(`[MCP] Creating new connection for "${serverId}"`);
    }

    // Connect and initialize if needed
    if (needsInitialization) {
      await client.connect();
      await client.initialize();

      // Cache the connection
      mcpClientPool.set(serverId, {
        client,
        timestamp: Date.now()
      });
    }

    // Call the tool
    const result = await client.callTool(toolName, arguments);
    const safeResult = sanitizeMcpToolValue(result);
    const resultObject = safeResult && typeof safeResult === 'object' && !Array.isArray(safeResult)
      ? safeResult
      : { value: safeResult };
    const duration = Date.now() - startTime;

    // Check result size, truncate if > 10KB
    const resultStr = JSON.stringify(resultObject);
    if (resultStr.length > 10 * 1024) {
      return {
        result: {
          ...resultObject,
          truncated: true
        },
        truncatedSize: resultStr.length,
        duration,
        isError: resultObject.isError || false
      };
    }

    return {
      result: resultObject,
      duration,
      isError: resultObject.isError || false
    };

  } catch (err) {
    // Clean up failed connection from pool
    const cached = mcpClientPool.get(serverId);
    if (cached) {
      try {
        await cached.client.disconnect();
      } catch (e) {
        // ignore
      }
      mcpClientPool.delete(serverId);
    }

    const failure = buildMcpFailureResult(err, err.message, Date.now() - startTime);
    return {
      result: {
        error: failure.message,
        ...(err.code ? { code: sanitizeMcpErrorText(err.code) } : {})
      },
      duration: failure.duration,
      isError: true,
      message: failure.message,
      hint: failure.hint
    };
  }
}

/**
 * 更新服务器状态
 */
async function updateServerStatus(serverId, status) {
  const servers = getAllServers();
  const server = servers[serverId];

  if (!server) {
    throw new Error(`MCP 服务器 "${serverId}" 不存在`);
  }

  server.status = status;
  server.lastChecked = Date.now();

  writeJsonFile(MCP_SERVERS_FILE, servers);
  return server;
}

// ============================================================================
// 排序功能
// ============================================================================

/**
 * 更新服务器排序
 * @param {string[]} serverIds - 按顺序排列的服务器 ID 数组
 */
function updateServerOrder(serverIds) {
  const servers = getAllServers();

  // 更新每个服务器的排序索引
  serverIds.forEach((id, index) => {
    const normalizedId = validateMcpId(id);
    if (Object.prototype.hasOwnProperty.call(servers, normalizedId)) {
      servers[normalizedId].order = index;
    }
  });

  writeJsonFile(MCP_SERVERS_FILE, servers);
  return servers;
}

// ============================================================================
// 导出功能
// ============================================================================

/**
 * 导出所有 MCP 配置
 * @param {string} format - 导出格式: json 或声明了导出操作的 MCP 平台 key
 */
function exportServers(format = 'json') {
  const servers = getAllServers();
  if (format === 'json') return exportAsJson(servers);

  const { platform, driver } = requireMcpCapability(format);
  if (typeof driver.export !== 'function') {
    const error = createPlatformCapabilityError(platform, 'mcp', 'unsupported');
    error.operation = 'export';
    throw error;
  }
  return driver.export(servers);
}

/**
 * 导出为通用 JSON 格式
 */
function exportAsJson(servers) {
  const mcpServers = {};

  for (const [id, server] of Object.entries(servers)) {
    mcpServers[id] = sanitizeExportSpec(server.server);
  }

  return {
    format: 'json',
    content: JSON.stringify({ mcpServers }, null, 2),
    filename: 'mcp-servers.json',
    contentType: 'application/json'
  };
}


module.exports = {
  getAllServers,
  getServer,
  saveServer,
  deleteServer,
  toggleServerApp,
  getPresets,
  importFromPlatform,
  getStats,
  validateServerSpec,
  readPlatformMcpConfig,
  writePlatformMcpConfig,
  removePlatformMcpServer,
  syncPlatformMcpServer,
  importPlatformMcpServers,
  exportPlatformMcpServers,
  getMcpPlatformKeys,
  // 新增功能
  testServer,
  getServerTools,
  callServerTool,
  updateServerStatus,
  updateServerOrder,
  exportServers,
  _test: {
    extractMcpHint,
    buildMcpFailureResult,
    convertToOmpMcpFormat,
    convertFromOmpMcpFormat
  }
};
