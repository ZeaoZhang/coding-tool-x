/**
 * 请求日志服务
 *
 * 通过环境变量控制是否记录各类请求日志：
 *
 *   CC_TOOL_LOG_REQUESTS=true        - 总开关：是否将代理请求快照写入 JSONL 文件（默认 false，需显式开启）
 *   CC_TOOL_LOG_API_REQUESTS=true    - 是否将 Web UI REST API 请求写入日志文件（默认 false）
 *
 * 日志文件位置：
 *   ~/.cc-tool/claude-requests.jsonl
 *   ~/.cc-tool/codex-requests.jsonl
 *   ~/.cc-tool/gemini-requests.jsonl
 *   ~/.cc-tool/opencode-requests.jsonl
 *   ~/.cc-tool/logs/api-requests.jsonl
 */

const fs = require('fs');
const path = require('path');
const pathsModule = require('../../config/paths');
const { PATHS } = pathsModule;
const getPlatformStatePath = typeof pathsModule.getPlatformStatePath === 'function'
  ? pathsModule.getPlatformStatePath
  : (category, platform) => PATHS[category]?.[platform];
const latestProxyRequestSnapshots = new Map();

// Includes the active write; slow storage cannot retain an unbounded body queue.
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
let logBytes = 0;
let logWriting = false;
let droppedSnapshots = 0;
let skippedTemplates = 0;
const logQueue = [];
const latestWrites = new Map();

function writeLatest(filePath, data) {
  let state = latestWrites.get(filePath);
  if (state) { state.pending = data; return; }
  state = { pending: null, activeBytes: Buffer.byteLength(data) };
  latestWrites.set(filePath, state);
  const write = (value) => {
    state.activeBytes = Buffer.byteLength(value);
    const finish = (error) => {
      if (error) console.error('[request-logger] Failed to write latest metadata:', error);
      if (state.pending !== null) {
        const next = state.pending;
        state.pending = null;
        write(next);
      } else latestWrites.delete(filePath);
    };
    try { fs.writeFile(filePath, value, finish); } catch (error) { finish(error); }
  };
  write(data);
}

function drainLogQueue() {
  if (logWriting || !logQueue.length) return;
  const entry = logQueue.shift();
  logWriting = true;
  const finish = (error) => {
    logBytes -= entry.bytes;
    logWriting = false;
    if (error) console.error('[request-logger] Failed to append request log:', error);
    drainLogQueue();
  };
  try { fs.appendFile(entry.filePath, entry.data, finish); } catch (error) { finish(error); }
}

function escapedStringBytes(value) {
  let bytes = Buffer.byteLength(value) + 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes++;
    else if (code < 32) bytes += 5;
  }
  return bytes;
}

function boundedStringify(payload, budget) {
  let estimated = 0;
  const data = JSON.stringify(payload, (key, value) => {
    estimated += escapedStringBytes(key) + 4;
    if (typeof value === 'string') estimated += escapedStringBytes(value);
    if (estimated > budget) throw new RangeError('Request log queue budget exceeded');
    return value;
  });
  if (Buffer.byteLength(data) + 1 > budget) throw new RangeError('Request log queue budget exceeded');
  return data;
}

function appendBoundedLog(filePath, payload) {
  let data;
  try { data = boundedStringify(payload, MAX_LOG_BYTES - logBytes) + '\n'; }
  catch { droppedSnapshots++; return; }
  const bytes = Buffer.byteLength(data);
  logBytes += bytes;
  logQueue.push({ filePath, data, bytes });
  drainLogQueue();
}

function getRequestLoggerDiagnostics() {
  return {
    queuedBytes: logBytes, pendingSnapshots: logQueue.length + Number(logWriting),
    droppedSnapshots, skippedTemplates, metadataEntries: latestProxyRequestSnapshots.size,
    latestWriteBytes: [...latestWrites.values()].reduce((sum, state) => sum + state.activeBytes +
      (state.pending === null ? 0 : Buffer.byteLength(state.pending)), 0)
  };
}

function rememberLatestSnapshot(source, compact) {
  latestProxyRequestSnapshots.delete(source);
  latestProxyRequestSnapshots.set(source, compact);
  while (latestProxyRequestSnapshots.size > 16) {
    latestProxyRequestSnapshots.delete(latestProxyRequestSnapshots.keys().next().value);
  }
  return compact;
}

function compactProxyRequestSnapshot(payload = {}) {
  const request = payload.request && typeof payload.request === 'object' ? payload.request : {};
  const route = payload.route && typeof payload.route === 'object' ? payload.route : undefined;
  return {
    ...(payload.timestamp !== undefined ? { timestamp: payload.timestamp } : {}),
    ...(payload.source ? { source: payload.source } : {}),
    request: {
      ...(request.method ? { method: request.method } : {}),
      ...(request.headers && typeof request.headers === 'object' ? { headers: request.headers } : {})
    },
    ...(route ? { route: { ...route } } : {})
  };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 总开关：代理请求快照写文件
 * 环境变量 CC_TOOL_LOG_REQUESTS=true 时开启，默认关闭（避免将含完整 messages 的请求体无限写入磁盘）
 */
function isProxyRequestLoggingEnabled() {
  const val = process.env.CC_TOOL_LOG_REQUESTS;
  if (!val) return false;
  return val.toLowerCase() === 'true' || val === '1';
}

/**
 * REST API 请求日志开关
 * 环境变量 CC_TOOL_LOG_API_REQUESTS=true 时开启，默认关闭
 */
function isApiRequestLoggingEnabled() {
  const val = process.env.CC_TOOL_LOG_API_REQUESTS;
  if (!val) return false;
  return val.toLowerCase() === 'true' || val === '1';
}

/**
 * 将代理请求快照异步追加写入 JSONL 文件
 * @param {string} source - 来源类型: 'claude' | 'codex' | 'gemini' | 'opencode'
 * @param {object} payload - 要写入的数据对象
 */
function persistProxyRequestSnapshot(source, payload) {
  if (!isProxyRequestLoggingEnabled()) return;

  try {
    const normalizedSource = String(source || '').trim().toLowerCase();
    if (!normalizedSource) return;
    const compact = compactProxyRequestSnapshot(payload);
    const metadata = boundedStringify(compact, MAX_METADATA_BYTES);
    rememberLatestSnapshot(normalizedSource, compact);
    const logPath = getPlatformStatePath('requestSnapshots', normalizedSource);
    if (!logPath) return;
    ensureDir(path.dirname(logPath));
    writeLatest(`${logPath}.latest.json`, metadata);
    appendBoundedLog(logPath, payload);
  } catch (error) {
    console.error(`[request-logger] Failed to persist ${source} request snapshot:`, error);
  }
}

function loadLatestProxyRequestSnapshot(source) {
  const normalizedSource = String(source || '').trim().toLowerCase();
  if (latestProxyRequestSnapshots.has(normalizedSource)) {
    return rememberLatestSnapshot(normalizedSource, latestProxyRequestSnapshots.get(normalizedSource));
  }
  const logPath = getPlatformStatePath('requestSnapshots', normalizedSource);
  if (!logPath) return {};

  try {
    const metadataPath = `${logPath}.latest.json`;
    if (fs.statSync(metadataPath).size <= MAX_METADATA_BYTES) {
      const compact = compactProxyRequestSnapshot(JSON.parse(fs.readFileSync(metadataPath, 'utf8')));
      rememberLatestSnapshot(normalizedSource, compact);
      return compact;
    }
  } catch { /* Legacy logs have no compact metadata sidecar. */ }

  let fd;
  try {
    fd = fs.openSync(logPath, 'r');
    const fileSize = fs.fstatSync(fd).size;
    const chunkSize = 64 * 1024;
    let position = fileSize;
    let parts = [];
    let lineBytes = 0;
    let skippingOversizedLine = false;
    let bytesScanned = 0;
    while (position > 0) {
      const bytesToRead = Math.min(position, chunkSize);
      position -= bytesToRead;
      bytesScanned += bytesToRead;
      const chunk = Buffer.alloc(bytesToRead);
      fs.readSync(fd, chunk, 0, bytesToRead, position);
      let segmentEnd = chunk.length;
      for (let index = chunk.length - 1; index >= 0; index -= 1) {
        if (chunk[index] !== 10) continue;
        const segment = chunk.subarray(index + 1, segmentEnd);
        lineBytes += segment.length;
        if (lineBytes > MAX_METADATA_BYTES) skippingOversizedLine = true;
        if (!skippingOversizedLine) parts.push(segment);
        const line = skippingOversizedLine ? '' : Buffer.concat(parts.reverse()).toString('utf8');
        parts = [];
        lineBytes = 0;
        skippingOversizedLine = false;
        segmentEnd = index;
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry && typeof entry === 'object') {
            const compact = compactProxyRequestSnapshot(entry);
            rememberLatestSnapshot(normalizedSource, compact);
            return compact;
          }
        } catch {
          // Ignore malformed records and continue scanning older complete lines.
        }
      }
      if (segmentEnd > 0) {
        lineBytes += segmentEnd;
        if (lineBytes > MAX_METADATA_BYTES) { skippingOversizedLine = true; parts = []; }
        if (!skippingOversizedLine) parts.push(chunk.subarray(0, segmentEnd));
      }
      if (position === 0 && !skippingOversizedLine && parts.length) {
        try {
          const compact = compactProxyRequestSnapshot(JSON.parse(Buffer.concat(parts.reverse()).toString('utf8')));
          rememberLatestSnapshot(normalizedSource, compact);
          return compact;
        } catch { /* Ignore a malformed oldest record. */ }
      }
      if (bytesScanned > 128 * 1024 * 1024) break;
    }
  } catch {
    // Request snapshots are optional and may not exist yet.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return {};
}

function loadLatestProxyRequestHeaders(source) {
  const headers = loadLatestProxyRequestSnapshot(source)?.request?.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};

  const hopByHopHeaders = new Set([
    'connection',
    'content-length',
    'host',
    'keep-alive',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
  ]);
  const sensitiveHeaderName = /(auth|cookie|session|token|secret|credential|api[-_]?key|password|signature|\bjwt\b|capability)/i;

  return Object.fromEntries(Object.entries(headers).filter(([name]) => (
    !hopByHopHeaders.has(name.toLowerCase()) && !sensitiveHeaderName.test(name)
  )));
}

/**
 * 创建 Express 中间件，用于记录 REST API 请求
 * 仅当 CC_TOOL_LOG_API_REQUESTS=true 时生效
 */
function createApiRequestLogger() {
  return function apiRequestLogger(req, res, next) {
    if (!isApiRequestLoggingEnabled()) return next();

    const startTime = Date.now();
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let statusCode = 200;

    // 拦截响应以获取状态码和耗时
    function logAndCallThrough(fn, body) {
      statusCode = res.statusCode || 200;
      const duration = Date.now() - startTime;
      const entry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        url: req.originalUrl || req.url,
        statusCode,
        duration,
        ip: req.ip || req.connection?.remoteAddress || null,
        userAgent: req.headers?.['user-agent'] || null
      };

      try {
        ensureDir(PATHS.logs);
        const logPath = path.join(PATHS.logs, 'api-requests.jsonl');
        appendBoundedLog(logPath, entry);
      } catch (err) {
        console.error('[request-logger] Failed to write API request log:', err);
      }

      return fn(body);
    }

    res.json = (body) => logAndCallThrough(originalJson, body);
    res.send = (body) => {
      // 对于非 JSON 响应，只在实际调用 send 时记录一次
      if (res.headersSent) return originalSend(body);
      return logAndCallThrough(originalSend, body);
    };

    next();
  };
}

const CLAUDE_TEMPLATE_PATH = PATHS.claudeRequestTemplate;
const CLAUDE_TEMPLATE_MIN_SYSTEM_CHARS = 100;

const FALLBACK_CLAUDE_SYSTEM = Object.freeze([
  {
    type: 'text',
    text: 'x-anthropic-billing-header: cc_version=2.1.59; cc_entrypoint=cli; cch=00000;'
  },
  {
    type: 'text',
    text: "You are Claude Code, Anthropic's official CLI for Claude."
  }
]);

const FALLBACK_CLAUDE_TOOLS = Object.freeze([
  {
    name: 'Task',
    description: 'Launch a new agent to handle complex, multi-step tasks autonomously.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        prompt: { type: 'string' },
        subagent_type: { type: 'string' },
        model: { type: 'string' },
        resume: { type: 'string' },
        run_in_background: { type: 'boolean' },
        max_turns: { type: 'integer' },
        isolation: { type: 'string' }
      },
      required: ['description', 'prompt', 'subagent_type']
    }
  },
  {
    name: 'Bash',
    description: 'Executes a given bash command and returns its output.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number' },
        description: { type: 'string' },
        run_in_background: { type: 'boolean' },
        dangerouslyDisableSandbox: { type: 'boolean' }
      },
      required: ['command']
    }
  },
  {
    name: 'Glob',
    description: 'Fast file pattern matching tool that works with any codebase size.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Grep',
    description: 'A powerful search tool built on ripgrep.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        glob: { type: 'string' },
        output_mode: { type: 'string' },
        '-B': { type: 'number' },
        '-A': { type: 'number' },
        '-C': { type: 'number' },
        context: { type: 'number' },
        '-n': { type: 'boolean' },
        '-i': { type: 'boolean' },
        type: { type: 'string' },
        head_limit: { type: 'number' },
        offset: { type: 'number' },
        multiline: { type: 'boolean' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Read',
    description: 'Reads a file from the local filesystem.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
        pages: { type: 'string' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'Edit',
    description: 'Performs exact string replacements in files.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  {
    name: 'Write',
    description: 'Writes a file to the local filesystem.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'ToolSearch',
    description: 'Search for or select deferred tools to make them available for use.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number' }
      },
      required: ['query', 'max_results']
    }
  }
]);

/**
 * 从 Claude 请求 body 提取模板（system/tools/userId），覆盖写入单一文件。
 * 无需环境变量开关，默认始终执行（合并待写版本，仅保留最新一次有效模板）。
 * @param {object} body - 请求 body 对象
 */
function persistClaudeRequestTemplate(body) {
  if (!body || typeof body !== 'object') return;

  const system = Array.isArray(body.system) ? body.system : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const userId = (body.metadata && typeof body.metadata.user_id === 'string')
    ? body.metadata.user_id
    : '';

  // 必须有 tools 且 system 有一定内容才算有效模板
  if (tools.length === 0) return;
  const systemCharCount = system.reduce((s, b) => s + (typeof b?.text === 'string' ? b.text.length : 0), 0);
  if (systemCharCount < CLAUDE_TEMPLATE_MIN_SYSTEM_CHARS) return;

  try {
    ensureDir(path.dirname(CLAUDE_TEMPLATE_PATH));
    const template = { updatedAt: Date.now(), userId, system, tools };
    let serialized;
    try { serialized = boundedStringify(template, MAX_LOG_BYTES); }
    catch { skippedTemplates++; return; }
    writeLatest(CLAUDE_TEMPLATE_PATH, serialized);
  } catch (err) {
    console.error('[request-logger] Failed to write claude-request-template.json:', err);
  }
}

/**
 * 读取 Claude 请求模板（同步）。
 * 若文件不存在或无效，返回内置 fallback（含 billing header 占位符和完整工具 schema）。
 * @returns {{ userId: string, system: Array, tools: Array }}
 */
function loadClaudeRequestTemplate() {
  try {
    if (fs.existsSync(CLAUDE_TEMPLATE_PATH)) {
      const raw = fs.readFileSync(CLAUDE_TEMPLATE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tools) && parsed.tools.length > 0 && Array.isArray(parsed.system)) {
        return { userId: parsed.userId || '', system: parsed.system, tools: parsed.tools };
      }
    }
  } catch {
    // fall through to fallback
  }
  return { userId: '', system: [...FALLBACK_CLAUDE_SYSTEM], tools: [...FALLBACK_CLAUDE_TOOLS] };
}

module.exports = {
  getRequestLoggerDiagnostics,
  isProxyRequestLoggingEnabled,
  isApiRequestLoggingEnabled,
  persistProxyRequestSnapshot,
  loadLatestProxyRequestSnapshot,
  loadLatestProxyRequestHeaders,
  persistClaudeRequestTemplate,
  loadClaudeRequestTemplate,
  createApiRequestLogger
};
