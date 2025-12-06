/**
 * 速度测试服务
 * 用于测试渠道 API 的响应延迟
 * 参考 cc-switch 的实现方式
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

// 测试结果缓存
const testResultsCache = new Map();

// Codex 请求体模板文件路径
const CODEX_REQUEST_TEMPLATE_PATH = path.join(__dirname, 'codex-speed-test-template.json');

// 超时配置（毫秒）
const DEFAULT_TIMEOUT = 15000;
const MIN_TIMEOUT = 5000;
const MAX_TIMEOUT = 60000;

/**
 * 规范化超时时间
 */
function sanitizeTimeout(timeout) {
  const ms = timeout || DEFAULT_TIMEOUT;
  return Math.min(Math.max(ms, MIN_TIMEOUT), MAX_TIMEOUT);
}

/**
 * 测试单个渠道的连接速度和 API 功能
 * @param {Object} channel - 渠道配置
 * @param {number} timeout - 超时时间（毫秒）
 * @param {string} channelType - 渠道类型：'claude' | 'codex' | 'gemini'
 * @returns {Promise<Object>} 测试结果
 */
async function testChannelSpeed(channel, timeout = DEFAULT_TIMEOUT, channelType = 'claude') {
  const sanitizedTimeout = sanitizeTimeout(timeout);

  try {
    if (!channel.baseUrl) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        success: false,
        networkOk: false,
        apiOk: false,
        error: 'URL 不能为空',
        latency: null,
        statusCode: null,
        testedAt: Date.now()
      };
    }

    // 规范化 URL（去除末尾斜杠）
    let testUrl;
    try {
      const url = new URL(channel.baseUrl.trim());
      testUrl = url.toString().replace(/\/+$/, '');
    } catch (urlError) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        success: false,
        networkOk: false,
        apiOk: false,
        error: `URL 无效: ${urlError.message}`,
        latency: null,
        statusCode: null,
        testedAt: Date.now()
      };
    }

    // 直接测试 API 功能（发送测试消息）
    // 不再单独测试网络连通性，因为直接 GET base_url 可能返回 404
    const apiResult = await testAPIFunctionality(testUrl, channel.apiKey, sanitizedTimeout, channelType, channel.model);

    const success = apiResult.success;
    const networkOk = apiResult.latency !== null; // 如果有延迟数据，说明网络是通的

    // 缓存结果
    const finalResult = {
      channelId: channel.id,
      channelName: channel.name,
      success,
      networkOk,
      apiOk: success,
      statusCode: apiResult.statusCode || null,
      error: success ? null : (apiResult.error || '测试失败'),
      latency: apiResult.latency || null, // 无论成功失败都保留延迟数据
      testedAt: Date.now()
    };

    testResultsCache.set(channel.id, finalResult);

    return finalResult;
  } catch (error) {
    return {
      channelId: channel.id,
      channelName: channel.name,
      success: false,
      networkOk: false,
      apiOk: false,
      error: error.message || '连接失败',
      latency: null,
      statusCode: null,
      testedAt: Date.now()
    };
  }
}

/**
 * 测试网络连通性（简单 GET 请求）
 */
function testNetworkConnectivity(url, apiKey, timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout,
      headers: {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Coding-Tool-SpeedTest/1.0'
      }
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const latency = Date.now() - startTime;
        resolve({
          statusCode: res.statusCode,
          latency,
          error: null
        });
      });
    });

    req.on('error', (error) => {
      let errorMsg;
      if (error.code === 'ECONNREFUSED') {
        errorMsg = '连接被拒绝';
      } else if (error.code === 'ETIMEDOUT') {
        errorMsg = '连接超时';
      } else if (error.code === 'ENOTFOUND') {
        errorMsg = 'DNS 解析失败';
      } else if (error.code === 'ECONNRESET') {
        errorMsg = '连接被重置';
      } else {
        errorMsg = error.message || '连接失败';
      }

      resolve({
        statusCode: null,
        latency: null,
        error: errorMsg
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        statusCode: null,
        latency: null,
        error: '请求超时'
      });
    });

    req.end();
  });
}

/**
 * 测试 API 功能（发送真实的聊天请求）
 * 根据渠道类型选择正确的 API 格式
 * @param {string} baseUrl - 基础 URL
 * @param {string} apiKey - API Key
 * @param {number} timeout - 超时时间
 * @param {string} channelType - 渠道类型：'claude' | 'codex' | 'gemini'
 * @param {string} model - 模型名称（可选，用于 Gemini）
 */
function testAPIFunctionality(baseUrl, apiKey, timeout, channelType = 'claude', model = null) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const parsedUrl = new URL(baseUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // 根据渠道类型确定 API 路径和请求格式
    let apiPath;
    let requestBody;
    let headers;

    // Claude 渠道使用 Anthropic 格式
    if (channelType === 'claude') {
      // Anthropic Messages API - 模拟 Claude Code 请求格式
      apiPath = parsedUrl.pathname.replace(/\/$/, '');
      if (!apiPath.endsWith('/messages')) {
        apiPath = apiPath + (apiPath.endsWith('/v1') ? '/messages' : '/v1/messages');
      }
      // 添加 ?beta=true 查询参数
      apiPath += '?beta=true';

      // 使用 Claude Code 的请求格式
      // user_id 必须符合特定格式: user_xxx_account__session_xxx
      // 使用 claude-sonnet-4 模型测试，因为 haiku 可能没有配额
      const sessionId = Math.random().toString(36).substring(2, 15);
      requestBody = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        stream: true,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
        metadata: { user_id: `user_0000000000000000000000000000000000000000000000000000000000000000_account__session_${sessionId}` }
      });

      headers = {
        'x-api-key': apiKey || '',
        'Authorization': `Bearer ${apiKey || ''}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-app': 'cli',
        'x-stainless-lang': 'js',
        'x-stainless-runtime': 'node',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-cli/2.0.53 (external, cli)'
      };
    } else if (channelType === 'codex') {
      // Codex 使用 OpenAI Responses API 格式
      // 路径: /v1/responses
      apiPath = parsedUrl.pathname.replace(/\/$/, '');
      if (!apiPath.endsWith('/responses')) {
        apiPath = apiPath + (apiPath.endsWith('/v1') ? '/responses' : '/v1/responses');
      }
      // 从模板文件加载完整的 Codex 请求格式
      try {
        const template = JSON.parse(fs.readFileSync(CODEX_REQUEST_TEMPLATE_PATH, 'utf-8'));
        // 生成新的 prompt_cache_key
        template.prompt_cache_key = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        requestBody = JSON.stringify(template);
      } catch (err) {
        console.error('[SpeedTest] Failed to load Codex template:', err.message);
        // 降级使用简化版本（可能会失败）
        requestBody = JSON.stringify({
          model: 'gpt-5-codex',
          instructions: 'You are Codex.',
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
          max_output_tokens: 10,
          stream: false,
          store: false
        });
      }
      headers = {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Content-Type': 'application/json',
        'User-Agent': 'codex_cli_rs/0.65.0',
        'openai-beta': 'responses=experimental'
      };
    } else if (channelType === 'gemini') {
      // Gemini 也使用 OpenAI 兼容格式
      apiPath = parsedUrl.pathname.replace(/\/$/, '');
      if (!apiPath.endsWith('/chat/completions')) {
        apiPath = apiPath + (apiPath.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions');
      }
      // 使用渠道配置的模型，如果没有则默认使用 gemini-2.5-pro
      const geminiModel = model || 'gemini-2.5-pro';
      requestBody = JSON.stringify({
        model: geminiModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      headers = {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Coding-Tool-SpeedTest/1.0'
      };
    } else {
      // 默认使用 OpenAI 格式
      apiPath = parsedUrl.pathname.replace(/\/$/, '');
      if (!apiPath.endsWith('/chat/completions')) {
        apiPath = apiPath + (apiPath.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions');
      }
      requestBody = JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      headers = {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Coding-Tool-SpeedTest/1.0'
      };
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: apiPath,
      method: 'POST',
      timeout,
      headers
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      let resolved = false;
      const isStreamingResponse = channelType === 'codex'; // Codex 使用流式响应

      // 解析响应体中的错误信息
      const parseErrorMessage = (responseData) => {
        try {
          const errData = JSON.parse(responseData);
          return errData.error?.message || errData.message || errData.detail || null;
        } catch {
          return null;
        }
      };

      res.on('data', chunk => {
        data += chunk;
        const chunkStr = chunk.toString();

        // 对于流式响应（Codex），在收到第一个有效事件时立即返回成功
        if (isStreamingResponse && !resolved && res.statusCode >= 200 && res.statusCode < 300) {
          // 检查是否收到了 response.created 或 response.in_progress 事件
          if (chunkStr.includes('response.created') || chunkStr.includes('response.in_progress')) {
            resolved = true;
            const latency = Date.now() - startTime;
            req.destroy();
            resolve({
              success: true,
              latency,
              error: null,
              statusCode: res.statusCode
            });
          } else if (chunkStr.includes('"detail"') || chunkStr.includes('"error"')) {
            // 流式响应中的错误
            resolved = true;
            const latency = Date.now() - startTime;
            req.destroy();
            const errMsg = parseErrorMessage(chunkStr) || '流式响应错误';
            resolve({
              success: false,
              latency,
              error: errMsg,
              statusCode: res.statusCode
            });
          }
        }
      });

      res.on('end', () => {
        if (resolved) return; // 已经处理过了

        const latency = Date.now() - startTime;

        // 严格判断：只有 2xx 且没有错误信息才算成功
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 检查响应体是否包含错误信息
          const errMsg = parseErrorMessage(data);
          if (errMsg && (errMsg.includes('error') || errMsg.includes('Error') ||
                         errMsg.includes('失败') || errMsg.includes('错误'))) {
            resolve({
              success: false,
              latency,
              error: errMsg,
              statusCode: res.statusCode
            });
          } else {
            // 真正的成功响应
            resolve({
              success: true,
              latency,
              error: null,
              statusCode: res.statusCode
            });
          }
        } else if (res.statusCode === 401) {
          resolve({
            success: false,
            latency,
            error: 'API Key 无效或已过期',
            statusCode: res.statusCode
          });
        } else if (res.statusCode === 403) {
          resolve({
            success: false,
            latency,
            error: 'API Key 权限不足',
            statusCode: res.statusCode
          });
        } else if (res.statusCode === 429) {
          // 请求过多 - 标记为失败
          const errMsg = parseErrorMessage(data) || '请求过多，服务限流中';
          resolve({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          });
        } else if (res.statusCode === 503 || res.statusCode === 529) {
          // 服务暂时不可用/过载 - 标记为失败
          const errMsg = parseErrorMessage(data) || (res.statusCode === 503 ? '服务暂时不可用' : '服务过载');
          resolve({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          });
        } else if (res.statusCode === 402) {
          resolve({
            success: false,
            latency,
            error: '账户余额不足',
            statusCode: res.statusCode
          });
        } else if (res.statusCode === 400) {
          // 请求参数错误
          const errMsg = parseErrorMessage(data) || '请求参数错误';
          resolve({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          });
        } else if (res.statusCode >= 500) {
          // 5xx 服务器错误
          const errMsg = parseErrorMessage(data) || `服务器错误 (${res.statusCode})`;
          resolve({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          });
        } else {
          // 其他错误
          const errMsg = parseErrorMessage(data) || `HTTP ${res.statusCode}`;
          resolve({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        latency: null,
        error: error.message || '请求失败'
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        latency: null,
        error: 'API 请求超时'
      });
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * 批量测试多个渠道
 * @param {Array} channels - 渠道列表
 * @param {number} timeout - 超时时间
 * @param {string} channelType - 渠道类型：'claude' | 'codex' | 'gemini'
 * @returns {Promise<Array>} 测试结果列表
 */
async function testMultipleChannels(channels, timeout = DEFAULT_TIMEOUT, channelType = 'claude') {
  const results = await Promise.all(
    channels.map(channel => testChannelSpeed(channel, timeout, channelType))
  );

  // 按延迟排序（成功的在前，按延迟升序）
  results.sort((a, b) => {
    if (a.success && !b.success) return -1;
    if (!a.success && b.success) return 1;
    if (a.success && b.success) return (a.latency || Infinity) - (b.latency || Infinity);
    return 0;
  });

  return results;
}

/**
 * 获取缓存的测试结果
 * @param {string} channelId - 渠道 ID
 * @returns {Object|null} 缓存的测试结果
 */
function getCachedResult(channelId) {
  const cached = testResultsCache.get(channelId);
  // 5 分钟内的缓存有效
  if (cached && Date.now() - cached.testedAt < 5 * 60 * 1000) {
    return cached;
  }
  return null;
}

/**
 * 清除测试结果缓存
 */
function clearCache() {
  testResultsCache.clear();
}

/**
 * 获取延迟等级
 * @param {number} latency - 延迟毫秒数
 * @returns {string} 等级：excellent/good/fair/poor
 */
function getLatencyLevel(latency) {
  if (!latency) return 'unknown';
  if (latency < 300) return 'excellent';   // < 300ms 优秀
  if (latency < 500) return 'good';        // < 500ms 良好
  if (latency < 800) return 'fair';        // < 800ms 一般
  return 'poor';                           // >= 800ms 较差
}

module.exports = {
  testChannelSpeed,
  testMultipleChannels,
  getCachedResult,
  clearCache,
  getLatencyLevel
};
