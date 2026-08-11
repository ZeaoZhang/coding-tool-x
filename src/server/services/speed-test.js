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
const { getEffectiveApiKey: getOmpEffectiveApiKey } = require('./omp-channels');
const { createCodexRequest } = require('./codex-wire');
const { createClaudeRequest, buildClaudeTargetUrl } = require('./claude-wire');
const {
  createGeminiRequest,
  buildGeminiTargetUrl,
  shouldUseGeminiCliFormat
} = require('./gemini-wire');

// 测试结果缓存
const testResultsCache = new Map();

// 超时配置（毫秒）
const DEFAULT_TIMEOUT = 15000;
const MIN_TIMEOUT = 5000;
const MAX_TIMEOUT = 60000;
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
    case 'omp':
      return getOmpEffectiveApiKey(channel);
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

function buildRequestPathFromTargetUrl(targetUrl) {
  if (!targetUrl) return '';
  try {
    const parsed = new URL(targetUrl);
    return parsed.pathname + parsed.search;
  } catch {
    return '';
  }
}

function resolveGeminiWireMode(channel, baseUrl) {
  const providerApi = String(channel?.providerApi || channel?.wireApi || '').trim().toLowerCase();
  if (providerApi === 'google-gemini-cli') return { useCli: true, allowFallback: false };
  if (providerApi === 'google-generative-ai' || providerApi === 'google-vertex') {
    return { useCli: false, allowFallback: false };
  }
  return { useCli: shouldUseGeminiCliFormat(baseUrl), allowFallback: true };
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
 * @param {string} channelType - 请求格式类型：'claude' | 'codex' | 'gemini' | 'opencode'
 * @param {Object} options - 可选行为
 * @param {string} options.authSourceType - API key 来源平台；OMP 使用 'omp'，请求格式仍由 channelType 决定
 * @returns {Promise<Object>} 测试结果
 */
async function testChannelSpeed(channel, timeout = DEFAULT_TIMEOUT, channelType = 'claude', options = {}) {
  const sanitizedTimeout = sanitizeTimeout(timeout);
  const authSourceType = options?.authSourceType || channelType;

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

    const effectiveApiKey = resolveEffectiveApiKey(channel, authSourceType);
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
    const aompResult = await testAPIFunctionality(
      testUrl,
      effectiveApiKey,
      sanitizedTimeout,
      channelType,
      channel.model,
      channel
    );

    const success = aompResult.success;
    const networkOk = aompResult.latency !== null; // 如果有延迟数据，说明网络是通的

    // 缓存结果
    const finalResult = {
      channelId: channel.id,
      channelName: channel.name,
      success,
      networkOk,
      apiOk: success,
      statusCode: aompResult.statusCode || null,
      error: success ? null : (aompResult.error || '测试失败'),
      latency: aompResult.latency ?? null, // 无论成功失败都保留延迟数据（保留 0ms）
      testedAt: Date.now(),
      testedModel: aompResult.testedModel,
      availableModels: aompResult.availableModels,
      modelDetectionMethod: aompResult.modelDetectionMethod
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
      // Only treat error as real error when it has actual content (not null/empty)
      const errorField = payload?.error;
      if (errorField && typeof errorField === 'object' && (errorField.message || errorField.type)) {
        return { hasError: true, message: errorField.message || String(errorField.type) };
      }
      if (errorField && typeof errorField === 'string' && errorField.trim()) {
        return { hasError: true, message: errorField };
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
    testModel = modelProbe?.preferredTestModel || normalizeNonEmptyString(model) || 'claude-sonnet-4-20250514';
    const requestPayload = {
      model: testModel,
      max_tokens: 10,
      temperature: 1,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }]
    };
    const primaryConverted = createClaudeRequest('/v1/messages', requestPayload, {
      apiKey,
      baseUrl,
      fallbackModel: testModel,
      stream: true
    });
    const fallbackConverted = createClaudeRequest('/v1/messages', requestPayload, {
      apiKey,
      baseUrl,
      fallbackModel: testModel,
      stream: false
    });
    const aompPath = buildRequestPathFromTargetUrl(buildClaudeTargetUrl(baseUrl));
    primaryRequestConfig = {
      aompPath,
      requestBody: JSON.stringify(primaryConverted.body),
      headers: primaryConverted.headers,
      isStreamingResponse: true
    };
    fallbackRequestConfig = {
      aompPath,
      requestBody: JSON.stringify(fallbackConverted.body),
      headers: fallbackConverted.headers,
      isStreamingResponse: false
    };
  } else if (channelType === 'codex') {
    const aompPath = buildCodexResponsesPath(parsedUrl);
    testModel = modelProbe?.preferredTestModel || normalizeNonEmptyString(model) || 'gpt-5.5';
    const codexSessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    const converted = createCodexRequest({
      model: testModel,
      instructions: 'You are Codex.',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
      prompt_cache_key: codexSessionId,
      stream: false,
      store: false
    }, {
      apiKey,
      sessionId: codexSessionId
    });

    primaryRequestConfig = {
      aompPath,
      requestBody: JSON.stringify(converted.body),
      headers: converted.headers,
      isStreamingResponse: true
    };
    fallbackRequestConfig = primaryRequestConfig;
  } else if (channelType === 'gemini') {
    testModel = modelProbe?.preferredTestModel || normalizeNonEmptyString(model) || 'gemini-2.5-pro';
    const minimalPayload = {
      model: testModel,
      max_output_tokens: 1,
      temperature: 0,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }]
    };
    const wireMode = resolveGeminiWireMode(channel, baseUrl);
    const createGeminiRequestConfig = (useCli) => {
      const converted = createGeminiRequest('/v1/responses', minimalPayload, {
        apiKey,
        fallbackModel: testModel,
        stream: false,
        useCli
      });
      return {
        aompPath: buildRequestPathFromTargetUrl(
          buildGeminiTargetUrl(baseUrl, converted.model, apiKey, { stream: false, useCli })
        ),
        requestBody: JSON.stringify(converted.body),
        headers: converted.headers,
        isStreamingResponse: false
      };
    };

    primaryRequestConfig = createGeminiRequestConfig(wireMode.useCli);
    fallbackRequestConfig = wireMode.allowFallback
      ? createGeminiRequestConfig(!wireMode.useCli)
      : null;
  } else if (channelType === 'openai_compatible' || channelType === 'opencode') {
    testModel = modelProbe?.preferredTestModel || normalizeNonEmptyString(model) || 'gpt-4o-mini';
    let aompPath = parsedUrl.pathname.replace(/\/$/, '');
    if (!aompPath.endsWith('/chat/completions')) {
      aompPath = aompPath + (aompPath.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions');
    }
    primaryRequestConfig = {
      aompPath,
      requestBody: JSON.stringify({
        model: testModel,
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
  } else {
    testModel = modelProbe?.preferredTestModel || normalizeNonEmptyString(model) || 'gpt-4o-mini';
    let aompPath = parsedUrl.pathname.replace(/\/$/, '');
    if (!aompPath.endsWith('/chat/completions')) {
      aompPath = aompPath + (aompPath.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions');
    }
    primaryRequestConfig = {
      aompPath,
      requestBody: JSON.stringify({
        model: testModel,
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
      path: requestConfig.aompPath,
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
          // Claude SSE events: message_start, ping, content_block_start, content_block_delta, message_delta, message_stop
          // Codex SSE events: response.created, response.in_progress
          const isClaudeStreamSuccess = chunkStr.includes('message_start') || chunkStr.includes('"message_stop"') || chunkStr.includes('"ping"') || chunkStr.includes('content_block');
          const isCodexStreamSuccess = chunkStr.includes('response.created') || chunkStr.includes('response.in_progress');
          if (isClaudeStreamSuccess || isCodexStreamSuccess) {
            resolved = true;
            const latency = Date.now() - startTime;
            req.destroy();
            resolve(createResult({
              success: true,
              latency,
              error: null,
              statusCode: res.statusCode
            }));
          } else if (chunkStr.includes('"detail"') || chunkStr.includes('"error"')) {
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

  if (channelType === 'claude' && ROUTE_OR_METHOD_MISMATCH_STATUS.has(primaryResult.statusCode)) {
    return executeRequest(fallbackRequestConfig);
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
