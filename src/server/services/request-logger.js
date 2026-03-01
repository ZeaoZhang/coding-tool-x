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
const os = require('os');

const CC_TOOL_DIR = path.join(os.homedir(), '.cc-tool');

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

module.exports = {
  isProxyRequestLoggingEnabled,
  isApiRequestLoggingEnabled,
  persistProxyRequestSnapshot,
  createApiRequestLogger
};
