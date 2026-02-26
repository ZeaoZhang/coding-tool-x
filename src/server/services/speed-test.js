/**
 * 速度测试服务
 * 用于测试渠道 API 的响应延迟
 * 参考 cc-switch 的实现方式
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { probeModelAvailability } = require('./model-detector');
const { getEffectiveApiKey: getClaudeEffectiveApiKey } = require('./channels');
const { getEffectiveApiKey: getCodexEffectiveApiKey } = require('./codex-channels');
const { getEffectiveApiKey: getGeminiEffectiveApiKey } = require('./gemini-channels');
const { getEffectiveApiKey: getOpenCodeEffectiveApiKey } = require('./opencode-channels');

// 测试结果缓存
const testResultsCache = new Map();

// 超时配置（毫秒）
const DEFAULT_TIMEOUT = 15000;
const MIN_TIMEOUT = 5000;
const MAX_TIMEOUT = 60000;
const CLAUDE_CODE_BETA_HEADER = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,prompt-caching-2024-07-31';
const ROUTE_OR_METHOD_MISMATCH_STATUS = new Set([404, 405, 501]);

/**
 * 规范化超时时间
 */
function sanitizeTimeout(timeout) {
  const ms = timeout || DEFAULT_TIMEOUT;
  return Math.min(Math.max(ms, MIN_TIMEOUT), MAX_TIMEOUT);
}

/**
 * 规范化批量测速并发度（默认小并发）
 */
function sanitizeBatchConcurrency(concurrency, defaultValue = 2) {
  const value = Number(concurrency);
  if (!Number.isFinite(value) || value <= 0) {
    return defaultValue;
  }
  return Math.min(Math.max(Math.round(value), 1), 5);
}

/**
 * 按并发限制执行异步任务，保持结果顺序与输入一致
 */
async function runWithConcurrencyLimit(items, concurrency, taskFn) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const limit = sanitizeBatchConcurrency(concurrency);
  const results = new Array(list.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= list.length) {
        return;
      }
      results[currentIndex] = await taskFn(list[currentIndex], currentIndex);
    }
  }

  const workers = [];
  const workerCount = Math.min(limit, list.length);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function normalizeNonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveExplicitModel(channel, model) {
  return (
    normalizeNonEmptyString(model)
    || normalizeNonEmptyString(channel?.model)
    || normalizeNonEmptyString(channel?.modelConfig?.model)
  );
}

function resolveEffectiveApiKey(channel, channelType) {
  switch (channelType) {
    case 'codex':
      return getCodexEffectiveApiKey(channel);
    case 'gemini':
      return getGeminiEffectiveApiKey(channel);
    case 'opencode':
      return getOpenCodeEffectiveApiKey(channel);
    case 'claude':
    default:
      return getClaudeEffectiveApiKey(channel);
  }
}

function mapStainlessOs() {
  switch (process.platform) {
    case 'darwin':
      return 'MacOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return `other::${process.platform}`;
  }
}

function mapStainlessArch() {
  switch (process.arch) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'arm64';
    case 'ia32':
      return 'x86';
    default:
      return `other::${process.arch}`;
  }
}

function buildGeminiNativeGeneratePath(parsedUrl, model) {
  let pathname = parsedUrl.pathname.replace(/\/+$/, '');
  const modelsIndex = pathname.indexOf('/models');
  if (modelsIndex >= 0) {
    pathname = pathname.slice(0, modelsIndex);
  }

  let apiBasePath;
  if (!pathname || pathname === '/') {
    apiBasePath = '/v1beta';
  } else if (pathname.endsWith('/v1beta') || pathname.endsWith('/v1')) {
    apiBasePath = pathname;
  } else {
    apiBasePath = `${pathname}/v1beta`;
  }

  return `${apiBasePath}/models/${encodeURIComponent(model)}:generateContent`;
}

function buildGeminiCliGeneratePath(parsedUrl) {
  let pathname = parsedUrl.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    return '/v1internal:generateContent';
  }
  if (pathname.endsWith(':streamGenerateContent')) {
    return pathname.replace(/:streamGenerateContent$/, ':generateContent');
  }
  if (pathname.endsWith(':generateContent')) {
    return pathname;
  }
  if (pathname.endsWith('/v1internal')) {
    return `${pathname}:generateContent`;
  }
  if (pathname.endsWith('/v1')) {
    return '/v1internal:generateContent';
  }
  return `${pathname}/v1internal:generateContent`;
}

function buildCodexResponsesPath(parsedUrl) {
  let pathname = parsedUrl.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    return '/responses';
  }
  if (pathname.endsWith('/responses') || pathname.endsWith('/v1/responses')) {
    return pathname;
  }
  if (pathname.endsWith('/v1')) {
    return `${pathname}/responses`;
  }
  return `${pathname}/responses`;
}

function shouldUseGeminiCliFormat(parsedUrl) {
  const host = String(parsedUrl.hostname || '').toLowerCase();
  const pathname = parsedUrl.pathname.replace(/\/+$/, '');

  if (pathname.includes('/v1internal') || pathname.endsWith(':generateContent') || pathname.endsWith(':streamGenerateContent')) {
    return true;
  }
  if (pathname.includes('/v1beta') || pathname.includes('/models/')) {
    return false;
  }
  if (host.includes('cloudcode-pa.googleapis.com')) {
    return true;
  }
  if (!pathname || pathname === '/') {
    return !host.includes('generativelanguage.googleapis.com') && !host.includes('aiplatform.googleapis.com');
  }
  return false;
}

function extractJsonPayloads(responseData) {
  const payloads = [];
  const text = typeof responseData === 'string' ? responseData : String(responseData || '');
  if (!text.trim()) {
    return payloads;
  }

  try {
    payloads.push(JSON.parse(text));
  } catch {
    // ignore and continue parsing SSE fragments
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const rawData = trimmed.slice(5).trim();
    if (!rawData || rawData === '[DONE]') continue;
    try {
      payloads.push(JSON.parse(rawData));
    } catch {
      // ignore invalid SSE fragment
    }
  }

  return payloads;
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

    const effectiveApiKey = resolveEffectiveApiKey(channel, channelType);
    if (!effectiveApiKey) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        success: false,
        networkOk: false,
        apiOk: false,
        error: 'API Key 未配置',
        latency: null,
        statusCode: null,
        testedAt: Date.now()
      };
    }

    // 直接测试 API 功能（发送测试消息）
    // 不再单独测试网络连通性，因为直接 GET base_url 可能返回 404
    const apiResult = await testAPIFunctionality(
      testUrl,
      effectiveApiKey,
      sanitizedTimeout,
      channelType,
      channel.model,
      channel
    );

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
      latency: apiResult.latency ?? null, // 无论成功失败都保留延迟数据（保留 0ms）
      testedAt: Date.now(),
      testedModel: apiResult.testedModel,
      availableModels: apiResult.availableModels,
      modelDetectionMethod: apiResult.modelDetectionMethod
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
 * @param {Object} channel - 完整渠道配置（用于模型检测）
 */
async function testAPIFunctionality(baseUrl, apiKey, timeout, channelType = 'claude', model = null, channel = null) {
  // Probe model availability if channel is provided
  let modelProbe = null;
  if (channel) {
    const configuredSpeedTestModel = normalizeNonEmptyString(channel.speedTestModel);
    const explicitModel = resolveExplicitModel(channel, model);

    // 优先使用 speedTestModel，避免测速时额外探测
    if (configuredSpeedTestModel) {
      // Use the explicitly configured model for speed testing
      modelProbe = {
        preferredTestModel: configuredSpeedTestModel,
        availableModels: [configuredSpeedTestModel],
        cached: false,
        method: 'configured'
      };
      console.log(`[SpeedTest] Using configured speedTestModel: ${configuredSpeedTestModel}`);
    } else if (explicitModel) {
      modelProbe = {
        preferredTestModel: explicitModel,
        availableModels: [explicitModel],
        cached: false,
        method: 'configured'
      };
      console.log(`[SpeedTest] Using explicit model: ${explicitModel}`);
    } else {
      // Fall back to auto-detection
      try {
        modelProbe = await probeModelAvailability(channel, channelType, { stopOnFirstAvailable: true });
      } catch (error) {
        console.error('[SpeedTest] Model detection failed:', error.message);
      }
    }
  }

  const parsedUrl = new URL(baseUrl);
  const isHttps = parsedUrl.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  // 根据渠道类型确定 API 路径和请求格式
  let testModel = null;
  let primaryRequestConfig = null;
  let fallbackRequestConfig = null;

  // Helper to create result object with model info
  const createResult = (result) => ({
    ...result,
    testedModel: testModel,
    availableModels: modelProbe?.availableModels,
    modelDetectionMethod: modelProbe?.method || (modelProbe?.cached ? 'cached' : 'probed')
  });

  const parseErrorMessage = (responseData) => {
    const payloads = extractJsonPayloads(responseData);
    for (const payload of payloads) {
      const message = payload?.error?.message || payload?.message || payload?.detail || payload?.error_description;
      if (message) return message;
    }
    return null;
  };

  const UNEXPECTED_ERROR_PATTERNS = [
    /unexpected/i,
    /internal.*error/i,
    /something.*went.*wrong/i,
    /service.*unavailable/i,
    /temporarily.*unavailable/i,
    /try.*again.*later/i,
    /server.*error/i,
    /bad.*gateway/i,
    /gateway.*timeout/i
  ];

  function containsUnexpectedError(responseBody) {
    const payloads = extractJsonPayloads(responseBody);
    for (const payload of payloads) {
      if (payload?.error) {
        return { hasError: true, message: payload.error.message || payload.error };
      }
      const message = payload?.message || payload?.detail || payload?.error_description || '';
      for (const pattern of UNEXPECTED_ERROR_PATTERNS) {
        if (pattern.test(message)) {
          return { hasError: true, message };
        }
      }
    }
    return { hasError: false };
  }

  if (channelType === 'claude') {
    // Anthropic Messages API - 模拟 Claude Code 请求格式
    let apiPath = parsedUrl.pathname.replace(/\/$/, '');
    if (!apiPath.endsWith('/messages')) {
      apiPath = apiPath + (apiPath.endsWith('/v1') ? '/messages' : '/v1/messages');
    }
    apiPath += '?beta=true';

    testModel = modelProbe?.preferredTestModel || normalizeNonEmptyString(model) || 'claude-sonnet-4-20250514';
    const sessionId = Math.random().toString(36).substring(2, 15);
    primaryRequestConfig = {
      apiPath,
      requestBody: JSON.stringify({
        model: testModel,
        max_tokens: 1,
        stream: false,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
        metadata: { user_id: `user_0000000000000000000000000000000000000000000000000000000000000000_account__session_${sessionId}` }
      }),
      headers: {
        'x-api-key': apiKey || '',
        'Authorization': `Bearer ${apiKey || ''}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': CLAUDE_CODE_BETA_HEADER,
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-app': 'cli',
        'x-stainless-helper-method': 'stream',
        'x-stainless-retry-count': '0',
        'x-stainless-runtime-version': 'v24.3.0',
        'x-stainless-package-version': '0.74.0',
        'x-stainless-lang': 'js',
        'x-stainless-runtime': 'node',
        'x-stainless-arch': mapStainlessArch(),
        'x-stainless-os': mapStainlessOs(),
        'x-stainless-timeout': '600',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-cli/2.1.44 (external, sdk-cli)'
      },
      isStreamingResponse: false
    };
  } else if (channelType === 'codex') {
    const apiPath = buildCodexResponsesPath(parsedUrl);
    testModel = modelProbe?.preferredTestModel || normalizeNonEmptyString(model) || 'gpt-5-codex';
    const codexSessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    const baseBody = {
      model: testModel,
      instructions: 'You are Codex.',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
      store: false,
      prompt_cache_key: codexSessionId
    };

    primaryRequestConfig = {
      apiPath,
      requestBody: JSON.stringify({ ...baseBody, stream: false }),
      headers: {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Accept': 'application/json',
        'Connection': 'Keep-Alive',
        'Version': '0.101.0',
        'Session_id': codexSessionId,
        'Originator': 'codex_cli_rs',
        'Content-Type': 'application/json',
        'User-Agent': 'codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464',
        'openai-beta': 'responses=experimental'
      },
      isStreamingResponse: false
    };

    fallbackRequestConfig = {
      apiPath,
      requestBody: JSON.stringify({ ...baseBody, stream: true }),
      headers: {
        ...primaryRequestConfig.headers,
        'Accept': 'text/event-stream'
      },
      isStreamingResponse: true
    };
  } else if (channelType === 'gemini') {
    testModel = modelProbe?.preferredTestModel || normalizeNonEmptyString(model) || 'gemini-2.5-pro';
    const useCliFormat = shouldUseGeminiCliFormat(parsedUrl);

    const cliRequestConfig = {
      apiPath: buildGeminiCliGeneratePath(parsedUrl),
      requestBody: JSON.stringify({
        project: '',
        model: testModel,
        request: {
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 }
        }
      }),
      headers: {
        'Authorization': `Bearer ${apiKey || ''}`,
        'x-goog-api-key': apiKey || '',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'google-api-nodejs-client/9.15.1',
        'X-Goog-Api-Client': 'gl-node/22.17.0',
        'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI'
      },
      isStreamingResponse: false
    };

    const nativeRequestConfig = {
      apiPath: buildGeminiNativeGeneratePath(parsedUrl, testModel),
      requestBody: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 }
      }),
      headers: {
        'Authorization': `Bearer ${apiKey || ''}`,
        'x-goog-api-key': apiKey || '',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'google-genai-sdk/0.8.0'
      },
      isStreamingResponse: false
    };

    primaryRequestConfig = useCliFormat ? cliRequestConfig : nativeRequestConfig;
    fallbackRequestConfig = useCliFormat ? nativeRequestConfig : cliRequestConfig;
  } else {
    let apiPath = parsedUrl.pathname.replace(/\/$/, '');
    if (!apiPath.endsWith('/chat/completions')) {
      apiPath = apiPath + (apiPath.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions');
    }
    primaryRequestConfig = {
      apiPath,
      requestBody: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }]
      }),
      headers: {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Coding-Tool-SpeedTest/1.0'
      },
      isStreamingResponse: false
    };
  }

  const executeRequest = (requestConfig) => new Promise((resolve) => {
    const startTime = Date.now();
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: requestConfig.apiPath,
      method: 'POST',
      timeout,
      headers: requestConfig.headers
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      let resolved = false;

      res.on('data', chunk => {
        data += chunk;
        const chunkStr = chunk.toString();

        if (requestConfig.isStreamingResponse && !resolved && res.statusCode >= 200 && res.statusCode < 300) {
          if (chunkStr.includes('response.created') || chunkStr.includes('response.in_progress')) {
            resolved = true;
            const latency = Date.now() - startTime;
            req.destroy();
            resolve(createResult({
              success: true,
              latency,
              error: null,
              statusCode: res.statusCode
            }));
          } else if (chunkStr.includes('"detail"') || chunkStr.includes('"error"') || chunkStr.includes('data:')) {
            const errorCheck = containsUnexpectedError(chunkStr);
            if (errorCheck.hasError) {
              resolved = true;
              const latency = Date.now() - startTime;
              req.destroy();
              resolve(createResult({
                success: false,
                latency,
                error: errorCheck.message,
                statusCode: res.statusCode
              }));
            }
          }
        }
      });

      res.on('end', () => {
        if (resolved) return;

        const latency = Date.now() - startTime;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const errorCheck = containsUnexpectedError(data);
          if (errorCheck.hasError) {
            resolve(createResult({
              success: false,
              latency,
              error: errorCheck.message,
              statusCode: res.statusCode
            }));
          } else {
            resolve(createResult({
              success: true,
              latency,
              error: null,
              statusCode: res.statusCode
            }));
          }
        } else if (res.statusCode === 401) {
          resolve(createResult({
            success: false,
            latency,
            error: 'API Key 无效或已过期',
            statusCode: res.statusCode
          }));
        } else if (res.statusCode === 403) {
          resolve(createResult({
            success: false,
            latency,
            error: 'API Key 权限不足',
            statusCode: res.statusCode
          }));
        } else if (res.statusCode === 429) {
          const errMsg = parseErrorMessage(data) || '请求过多，服务限流中';
          resolve(createResult({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          }));
        } else if (res.statusCode === 503 || res.statusCode === 529) {
          const errMsg = parseErrorMessage(data) || (res.statusCode === 503 ? '服务暂时不可用' : '服务过载');
          resolve(createResult({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          }));
        } else if (res.statusCode === 402) {
          resolve(createResult({
            success: false,
            latency,
            error: '账户余额不足',
            statusCode: res.statusCode
          }));
        } else if (res.statusCode === 400) {
          const errMsg = parseErrorMessage(data) || '请求参数错误';
          resolve(createResult({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          }));
        } else if (res.statusCode >= 500) {
          const errMsg = parseErrorMessage(data) || `服务器错误 (${res.statusCode})`;
          resolve(createResult({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          }));
        } else {
          const errMsg = parseErrorMessage(data) || `HTTP ${res.statusCode}`;
          resolve(createResult({
            success: false,
            latency,
            error: errMsg,
            statusCode: res.statusCode
          }));
        }
      });
    });

    req.on('error', (error) => {
      resolve(createResult({
        success: false,
        latency: null,
        error: error.message || '请求失败'
      }));
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(createResult({
        success: false,
        latency: null,
        error: 'API 请求超时'
      }));
    });

    req.write(requestConfig.requestBody);
    req.end();
  });

  const primaryResult = await executeRequest(primaryRequestConfig);
  if (primaryResult.success || !fallbackRequestConfig) {
    return primaryResult;
  }

  if (channelType === 'gemini' && ROUTE_OR_METHOD_MISMATCH_STATUS.has(primaryResult.statusCode)) {
    return executeRequest(fallbackRequestConfig);
  }

  if (channelType === 'codex') {
    const codexError = String(primaryResult.error || '').toLowerCase();
    const shouldRetryWithStreaming = ROUTE_OR_METHOD_MISMATCH_STATUS.has(primaryResult.statusCode)
      || (primaryResult.statusCode === 400 && (codexError.includes('stream') || codexError.includes('event-stream') || codexError.includes('sse')));
    if (shouldRetryWithStreaming) {
      return executeRequest(fallbackRequestConfig);
    }
  }

  return primaryResult;
}

/**
 * 批量测试多个渠道
 * @param {Array} channels - 渠道列表
 * @param {number} timeout - 超时时间
 * @param {string} channelType - 渠道类型：'claude' | 'codex' | 'gemini'
 * @returns {Promise<Array>} 测试结果列表
 */
async function testMultipleChannels(channels, timeout = DEFAULT_TIMEOUT, channelType = 'claude', concurrency = 2) {
  const results = await runWithConcurrencyLimit(
    channels,
    concurrency,
    channel => testChannelSpeed(channel, timeout, channelType)
  );

  // 按延迟排序（成功的在前，按延迟升序）
  results.sort((a, b) => {
    if (a.success && !b.success) return -1;
    if (!a.success && b.success) return 1;
    if (a.success && b.success) {
      const aLatency = (a.latency === null || a.latency === undefined) ? Infinity : a.latency;
      const bLatency = (b.latency === null || b.latency === undefined) ? Infinity : b.latency;
      return aLatency - bLatency;
    }
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
  if (latency === null || latency === undefined) return 'unknown';
  if (!Number.isFinite(Number(latency))) return 'unknown';
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
  getLatencyLevel,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit
};
