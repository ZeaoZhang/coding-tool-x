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
const { PATHS } = require('../../config/paths');

const CC_TOOL_DIR = PATHS.base;

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
    ensureDir(CC_TOOL_DIR);
    const logPath = path.join(CC_TOOL_DIR, `${source}-requests.jsonl`);
    fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, (error) => {
      if (error) {
        console.error(`[request-logger] Failed to persist ${source} request snapshot:`, error);
      }
    });
  } catch (error) {
    console.error(`[request-logger] Failed to persist ${source} request snapshot:`, error);
  }
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
        ensureDir(path.join(CC_TOOL_DIR, 'logs'));
        const logPath = path.join(CC_TOOL_DIR, 'logs', 'api-requests.jsonl');
        fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, (err) => {
          if (err) {
            console.error('[request-logger] Failed to write API request log:', err);
          }
        });
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

const CLAUDE_TEMPLATE_PATH = path.join(CC_TOOL_DIR, 'claude-request-template.json');
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
 * 无需环境变量开关，默认始终执行（文件极小，仅保留最新一次有效模板）。
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
    ensureDir(CC_TOOL_DIR);
    const template = { updatedAt: Date.now(), userId, system, tools };
    fs.writeFile(CLAUDE_TEMPLATE_PATH, JSON.stringify(template), (err) => {
      if (err) console.error('[request-logger] Failed to write claude-request-template.json:', err);
    });
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
  isProxyRequestLoggingEnabled,
  isApiRequestLoggingEnabled,
  persistProxyRequestSnapshot,
  persistClaudeRequestTemplate,
  loadClaudeRequestTemplate,
  createApiRequestLogger
};
