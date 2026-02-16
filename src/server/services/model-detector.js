/**
 * Model Detector Service
 * Probes model availability for channels and caches results
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const zlib = require('zlib');
const { loadConfig } = require('../../config/loader');

// 内置模型优先级（当配置缺失时兜底）
const MODEL_PRIORITY = {
  claude: [
    'claude-opus-4-6',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514'
  ],
  codex: [
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
    'gpt-5.1-codex',
    'gpt-5-codex',
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5'
  ],
  gemini: [
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-3-deep-think',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
  ]
};
// openai_compatible 复用 codex 的模型列表
MODEL_PRIORITY.openai_compatible = MODEL_PRIORITY.codex;

function normalizeModelToolType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (value === 'openai_compatible') return 'codex';
  if (value === 'claude' || value === 'codex' || value === 'gemini' || value === 'opencode') {
    return value;
  }
  return '';
}

/**
 * 获取模型优先级列表（优先读取用户配置的 defaultModels）
 * @param {string} channelType - 渠道类型
 * @param {Object} options - 可选参数
 * @param {string} options.toolType - 显式工具类型（claude/codex/gemini/opencode）
 * @returns {string[]}
 */
function getModelPriority(channelType, options = {}) {
  const preferredToolType = normalizeModelToolType(options.toolType);
  const normalizedChannelType = normalizeModelToolType(channelType);
  const candidateTypes = [];

  if (preferredToolType) {
    candidateTypes.push(preferredToolType);
  }
  if (normalizedChannelType && !candidateTypes.includes(normalizedChannelType)) {
    candidateTypes.push(normalizedChannelType);
  }
  if (String(channelType || '').trim().toLowerCase() === 'openai_compatible' && !candidateTypes.includes('openai_compatible')) {
    candidateTypes.push('openai_compatible');
  }

  try {
    const config = loadConfig();
    const defaultModels = config?.defaultModels || {};
    for (const toolType of candidateTypes) {
      const models = defaultModels[toolType];
      if (Array.isArray(models) && models.length > 0) {
        return [...models];
      }
    }
  } catch (error) {
    console.warn(`[ModelDetector] Failed to load default models config: ${error.message}`);
  }

  for (const toolType of candidateTypes) {
    const models = MODEL_PRIORITY[toolType];
    if (Array.isArray(models) && models.length > 0) {
      return [...models];
    }
  }

  return [];
}

const PROVIDER_CAPABILITIES = {
  claude: {
    supportsModelList: false,
    modelListEndpoint: null,
    fallbackStrategy: 'probe'
  },
  codex: {
    supportsModelList: true,
    modelListEndpoint: '/v1/models',
    authHeader: 'Authorization: Bearer'
  },
  gemini: {
    supportsModelList: false,
    modelListEndpoint: null,
    fallbackStrategy: 'probe'
  },
  openai_compatible: {
    supportsModelList: true,
    modelListEndpoint: '/v1/models',
    authHeader: 'Authorization: Bearer'
  }
};

/**
 * Auto-detect channel type based on baseUrl
 * @param {Object} channel - Channel configuration
 * @returns {string} - 'claude' | 'codex' | 'gemini' | 'openai_compatible'
 */
function detectChannelType(channel) {
  try {
    // Parse the URL to extract hostname
    const parsedUrl = new URL(channel.baseUrl);
    const hostname = parsedUrl.hostname.toLowerCase();

    // Check if it's official Anthropic API (hostname only, not path)
    if (hostname.includes('anthropic.com') || hostname.includes('claude.ai')) {
      return 'claude';
    }

    // Check if it's Gemini (hostname only)
    if (hostname.includes('generativelanguage.googleapis.com') || hostname.includes('gemini')) {
      return 'gemini';
    }

    // Check if it's OpenAI official (hostname only)
    if (hostname.includes('api.openai.com')) {
      return 'codex';
    }

    // All other third-party proxies default to OpenAI compatible
    // Including: 88code, anyrouter, internal proxies, etc.
    // This correctly handles URLs like https://code.newcli.com/claude/aws
    return 'openai_compatible';
  } catch (error) {
    // If URL parsing fails, fall back to string matching on full URL
    console.warn(`[ModelDetector] Failed to parse URL ${channel.baseUrl}: ${error.message}`);
    const baseUrl = channel.baseUrl.toLowerCase();

    if (baseUrl.includes('anthropic.com') || baseUrl.includes('claude.ai')) {
      return 'claude';
    }
    if (baseUrl.includes('generativelanguage.googleapis.com')) {
      return 'gemini';
    }
    if (baseUrl.includes('api.openai.com')) {
      return 'codex';
    }

    return 'openai_compatible';
  }
}

// Model name normalization mapping
const MODEL_ALIASES = {
  // Claude variants
  'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
  'claude-haiku-3-5': 'claude-haiku-3-5-20241022',
  'claude-3-haiku': 'claude-3-5-haiku-20241022',
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-4-sonnet': 'claude-sonnet-4-20250514',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-4-5-sonnet': 'claude-sonnet-4-5-20250929',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-4-opus': 'claude-opus-4-20250514',

  // Codex variants
  'gpt-4o': 'gpt-4o',
  'gpt4o': 'gpt-4o',
  'gpt-4-o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt4o-mini': 'gpt-4o-mini',
  'gpt-5': 'gpt-5-codex',
  'gpt5': 'gpt-5-codex',
  'o3': 'o3',

  // Gemini variants
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-2-5-flash': 'gemini-2.5-flash',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-pro': 'gemini-2.5-pro',
  'gemini-2-5-pro': 'gemini-2.5-pro'
};

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const TEST_TIMEOUT_MS = 10000; // 10 seconds per model test

/**
 * Generate realistic User-Agent strings that mimic official SDKs
 * @param {string} channelType - 'claude' | 'codex' | 'gemini' | 'openai_compatible'
 * @returns {string} - User-Agent string
 */
function getRealisticUserAgent(channelType) {
  const nodeVersion = process.version.slice(1); // e.g., "18.17.0"
  const platform = process.platform; // e.g., "darwin", "linux", "win32"

  switch (channelType) {
    case 'claude':
      // Mimics official Anthropic Python SDK
      return `anthropic-sdk-python/0.39.0 python/3.11.4 ${platform}`;
    case 'gemini':
      // Mimics official Google SDK
      return `google-generativeai/0.8.2 python/3.11.4 ${platform}`;
    case 'codex':
    case 'openai_compatible':
    default:
      // Mimics official OpenAI Python SDK
      return `OpenAI/Python/1.56.0`;
  }
}

/**
 * Add a small random delay between requests to avoid rate limiting
 * and appear more human-like (100-300ms)
 * @returns {Promise<void>}
 */
async function randomDelay() {
  const delay = 100 + Math.random() * 200;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Build common headers for API requests that look like legitimate SDK clients
 * @param {string} channelType - Channel type
 * @param {Object} channel - Channel configuration
 * @returns {Object} - Headers object
 */
function buildRequestHeaders(channelType, channel) {
  const headers = {
    'User-Agent': getRealisticUserAgent(channelType),
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
    'X-Request-Id': crypto.randomUUID()
  };

  // For OpenAI-compatible APIs, add additional headers
  if (channelType === 'codex' || channelType === 'openai_compatible') {
    headers['OpenAI-Beta'] = 'assistants=v2';
  }

  return headers;
}

function createDecodedStream(res) {
  const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
  if (encoding.includes('gzip')) return res.pipe(zlib.createGunzip());
  if (encoding.includes('deflate')) return res.pipe(zlib.createInflate());
  if (encoding.includes('br') && typeof zlib.createBrotliDecompress === 'function') {
    return res.pipe(zlib.createBrotliDecompress());
  }
  return res;
}

function collectResponseBody(res) {
  return new Promise((resolve, reject) => {
    const stream = createDecodedStream(res);
    let data = '';

    stream.on('data', chunk => {
      data += chunk.toString('utf8');
    });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
    res.on('error', reject);
  });
}

/**
 * Get cache file path
 */
function getCacheFilePath() {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'channel-models.json');
}

/**
 * Load model cache from disk
 */
function loadModelCache() {
  const cachePath = getCacheFilePath();
  try {
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('[ModelDetector] Error loading cache:', error.message);
  }
  return {};
}

/**
 * Save model cache to disk
 */
function saveModelCache(cache) {
  const cachePath = getCacheFilePath();
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    console.error('[ModelDetector] Error saving cache:', error.message);
  }
}

/**
 * Normalize model name to canonical form
 * @param {string} model - Raw model name
 * @returns {string} Normalized model name
 */
function normalizeModelName(model) {
  if (!model) return null;

  const normalized = model.toLowerCase().trim();
  return MODEL_ALIASES[normalized] || model;
}

/**
 * Check if cache entry is still valid
 * @param {Object} cacheEntry - Cache entry with lastChecked timestamp
 * @returns {boolean}
 */
function isCacheValid(cacheEntry) {
  if (!cacheEntry || !cacheEntry.lastChecked) {
    return false;
  }

  const age = Date.now() - new Date(cacheEntry.lastChecked).getTime();
  return age < CACHE_DURATION_MS;
}

/**
 * Test if a specific model is available for a channel
 * @param {Object} channel - Channel configuration
 * @param {string} channelType - 'claude' | 'codex' | 'gemini'
 * @param {string} model - Model name to test
 * @returns {Promise<boolean>}
 */
async function testModelAvailability(channel, channelType, model) {
  return new Promise((resolve) => {
    try {
      const baseUrl = channel.baseUrl.trim().replace(/\/+$/, '');
      let testUrl;
      let requestBody;
      // Start with common headers that look like legitimate SDK clients
      let headers = {
        ...buildRequestHeaders(channelType, channel),
        'Content-Type': 'application/json'
      };

      // Construct API endpoint and request based on channel type
      if (channelType === 'claude') {
        testUrl = `${baseUrl}/v1/messages`;
        headers['x-api-key'] = channel.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        requestBody = JSON.stringify({
          model: model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        });
      } else if (channelType === 'codex' || channelType === 'openai_compatible') {
        // 处理 baseUrl 已包含 /v1 的情况
        testUrl = baseUrl.endsWith('/v1')
          ? `${baseUrl}/chat/completions`
          : `${baseUrl}/v1/chat/completions`;
        headers['Authorization'] = `Bearer ${channel.apiKey}`;
        requestBody = JSON.stringify({
          model: model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        });
      } else if (channelType === 'gemini') {
        // Gemini uses API key in URL
        testUrl = `${baseUrl}/v1beta/models/${model}:generateContent?key=${channel.apiKey}`;
        requestBody = JSON.stringify({
          contents: [{ parts: [{ text: 'test' }] }],
          generationConfig: { maxOutputTokens: 1 }
        });
      } else {
        return resolve(false);
      }

      const parsedUrl = new URL(testUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        timeout: TEST_TIMEOUT_MS,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };

      const req = httpModule.request(options, (res) => {
        collectResponseBody(res)
          .then((data) => {
            // Success: 200-299 status codes
            if (res.statusCode >= 200 && res.statusCode < 300) {
              return resolve(true);
            }

            if (res.statusCode === 400 || res.statusCode === 404) {
              const extractErrorMessage = () => {
                const fallback = String(data || '');
                try {
                  const response = JSON.parse(data || '{}');
                  if (typeof response === 'string') return response;
                  if (typeof response?.error?.message === 'string') return response.error.message;
                  if (typeof response?.error === 'string') return response.error;
                  if (typeof response?.message === 'string') return response.message;
                  if (typeof response?.detail === 'string') return response.detail;
                  return fallback;
                } catch {
                  return fallback;
                }
              };

              const errorMsg = extractErrorMessage().toLowerCase();
              const modelLower = String(model || '').toLowerCase();
              const hasModelContext = errorMsg.includes('model')
                || errorMsg.includes('模型')
                || (modelLower && errorMsg.includes(modelLower));
              const modelUnavailableHints = [
                'not found',
                'does not exist',
                'invalid model',
                'unsupported model',
                'not supported',
                'model unavailable',
                'deprecated',
                'decommission',
                'retired',
                'offline',
                'unknown model',
                '下线',
                '已下线',
                '已停用',
                '已废弃',
                '已淘汰',
                '模型不存在',
                '无效模型',
                '不支持',
                '不可用',
                '请切换'
              ];

              if (res.statusCode === 404) {
                return resolve(false);
              }

              if (hasModelContext && modelUnavailableHints.some(hint => errorMsg.includes(hint))) {
                return resolve(false);
              }

              // 其他 400 错误大多是认证或参数问题，不能据此判定模型不可用
              return resolve(true);
            }

            // Other errors (401, 403, 500, etc.) are inconclusive
            return resolve(false);
          })
          .catch(() => resolve(false));
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.write(requestBody);
      req.end();

    } catch (error) {
      resolve(false);
    }
  });
}

/**
 * Probe model availability for a channel
 * Tests models in priority order and returns first available
 * Uses 5-minute cache to avoid repeated testing
 *
 * @param {Object} channel - Channel configuration
 * @param {string} channelType - 'claude' | 'codex' | 'gemini'
 * @returns {Promise<Object>} { availableModels: string[], preferredTestModel: string|null, cached: boolean }
 */
async function probeModelAvailability(channel, channelType, options = {}) {
  const forceRefresh = !!options.forceRefresh;
  const toolType = options.toolType;
  const cache = loadModelCache();
  const cacheKey = channel.id;

  // Return cached result if valid
  if (!forceRefresh && cache[cacheKey] && isCacheValid(cache[cacheKey])) {
    return {
      availableModels: cache[cacheKey].availableModels || [],
      preferredTestModel: cache[cacheKey].preferredTestModel || null,
      cached: true,
      lastChecked: cache[cacheKey].lastChecked
    };
  }

  // Get model priority list for this channel type
  const modelsToTest = getModelPriority(channelType, { toolType });
  if (modelsToTest.length === 0) {
    console.warn(`[ModelDetector] No models defined for channel type: ${channelType}`);
    return {
      availableModels: [],
      preferredTestModel: null,
      cached: false,
      lastChecked: new Date().toISOString()
    };
  }

  console.log(`[ModelDetector] Testing models for channel ${channel.name} (${channelType})...`);

  const availableModels = [];
  let isFirstModel = true;

  // Test models in priority order
  for (const model of modelsToTest) {
    // Add delay between model tests to avoid rate limiting (skip first)
    if (!isFirstModel) {
      await randomDelay();
    }
    isFirstModel = false;

    const isAvailable = await testModelAvailability(channel, channelType, model);

    if (isAvailable) {
      availableModels.push(model);
      console.log(`[ModelDetector] ✓ ${model} available`);
    } else {
      console.log(`[ModelDetector] ✗ ${model} not available`);
    }
  }

  const preferredTestModel = availableModels.length > 0 ? availableModels[0] : null;

  // Update cache
  const cacheEntry = {
    lastChecked: new Date().toISOString(),
    availableModels,
    preferredTestModel
  };

  cache[cacheKey] = cacheEntry;
  saveModelCache(cache);

  console.log(`[ModelDetector] Found ${availableModels.length} available model(s) for ${channel.name}`);

  return {
    availableModels,
    preferredTestModel,
    cached: false,
    lastChecked: cacheEntry.lastChecked
  };
}

/**
 * Clear cache for specific channel or all channels
 * @param {string|null} channelId - Channel ID to clear, or null for all
 */
function clearCache(channelId = null) {
  const cache = loadModelCache();

  if (channelId) {
    delete cache[channelId];
    console.log(`[ModelDetector] Cleared cache for channel: ${channelId}`);
  } else {
    // Clear all
    Object.keys(cache).forEach(key => delete cache[key]);
    console.log('[ModelDetector] Cleared all model cache');
  }

  saveModelCache(cache);
}

/**
 * Get cached model info without probing
 * @param {string} channelId - Channel ID
 * @returns {Object|null} Cache entry or null if not found/expired
 */
function getCachedModelInfo(channelId) {
  const cache = loadModelCache();
  const entry = cache[channelId];

  if (entry && isCacheValid(entry)) {
    return entry;
  }

  return null;
}

/**
 * Fetch available models from provider's /v1/models endpoint
 * @param {Object} channel - Channel configuration
 * @param {string} channelType - 'claude' | 'codex' | 'gemini' | 'openai_compatible'
 * @returns {Promise<Object>} { models: string[], supported: boolean, cached: boolean, error: string|null, fallbackUsed: boolean }
 */
async function fetchModelsFromProvider(channel, channelType) {
  // Only auto-detect if channelType is NOT specified at all
  // DO NOT auto-detect when channelType is 'claude' - respect the caller's intent
  if (!channelType) {
    channelType = detectChannelType(channel);
    console.log(`[ModelDetector] Auto-detected channel type: ${channelType} for ${channel.name}`);
  }

  // Check if provider supports model listing
  const capability = PROVIDER_CAPABILITIES[channelType];
  if (!capability || !capability.supportsModelList) {
    return {
      models: [],
      supported: false,
      fallbackUsed: true,
      cached: false,
      error: null
    };
  }

  const cache = loadModelCache();
  const cacheKey = channel.id;

  // Check cache first
  if (cache[cacheKey] && isCacheValid(cache[cacheKey]) && cache[cacheKey].fetchedModels) {
    return {
      models: cache[cacheKey].fetchedModels || [],
      supported: true,
      cached: true,
      fallbackUsed: false,
      error: null,
      lastChecked: cache[cacheKey].lastChecked
    };
  }

  return new Promise((resolve) => {
    try {
      const baseUrl = channel.baseUrl.trim().replace(/\/+$/, '');
      const endpoint = capability.modelListEndpoint; // e.g. '/v1/models'
      // 避免路径重复：如果 baseUrl 已包含 /v1，则只拼接 /models
      const requestUrl = baseUrl.endsWith('/v1') && endpoint.startsWith('/v1/')
        ? `${baseUrl}${endpoint.slice(3)}`
        : `${baseUrl}${endpoint}`;

      const parsedUrl = new URL(requestUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      // Use realistic SDK headers to avoid anti-crawler detection
      const headers = buildRequestHeaders(channelType, channel);

      // Add authentication header
      if (capability.authHeader) {
        if (channel.apiKey) {
          headers['Authorization'] = `Bearer ${channel.apiKey}`;
        }
      }

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        timeout: TEST_TIMEOUT_MS,
        headers
      };

      const req = httpModule.request(options, (res) => {
        collectResponseBody(res)
          .then((data) => {
            // Handle different status codes
            if (res.statusCode === 200) {
              try {
                const response = JSON.parse(data);

                // Parse OpenAI-compatible format: { data: [{ id: "model-name", ... }] }
                let models = [];
                if (response.data && Array.isArray(response.data)) {
                  models = response.data
                    .map(item => item.id || item.model)
                    .filter(Boolean);
                }

                // Update cache with fetched models
                const cacheEntry = {
                  lastChecked: new Date().toISOString(),
                  fetchedModels: models,
                  availableModels: cache[cacheKey]?.availableModels || [],
                  preferredTestModel: cache[cacheKey]?.preferredTestModel || null
                };

                cache[cacheKey] = cacheEntry;
                saveModelCache(cache);

                console.log(`[ModelDetector] Fetched ${models.length} models from ${channel.name}`);

                resolve({
                  models,
                  supported: true,
                  cached: false,
                  fallbackUsed: false,
                  error: null,
                  lastChecked: cacheEntry.lastChecked
                });
              } catch (parseError) {
                console.error(`[ModelDetector] Failed to parse models response: ${parseError.message}`);
                resolve({
                  models: [],
                  supported: true,
                  cached: false,
                  fallbackUsed: true,
                  error: `Parse error: ${parseError.message}`
                });
              }
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              // Check if it's a Cloudflare protection issue
              const bodyLower = data.toLowerCase();
              const isCloudflare = bodyLower.includes('cloudflare') || bodyLower.includes('challenge') || bodyLower.includes('cf-ray');

            let errorMessage;
            let errorHint;

            if (isCloudflare) {
              errorMessage = 'Cloudflare 防护拦截，无法自动获取模型列表';
              errorHint = '该 API 端点受 Cloudflare 保护，请手动填写模型名称';
              console.warn(`[ModelDetector] Cloudflare protection detected for ${channel.name}, no fallback models injected`);
              resolve({
                models: [],
                supported: false,
                cached: false,
                fallbackUsed: true,
                error: errorMessage,
                errorHint: errorHint,
                statusCode: res.statusCode
              });
            } else if (res.statusCode === 401) {
              errorMessage = 'API 密钥认证失败';
              errorHint = '请检查 API 密钥是否正确配置';
              console.error(`[ModelDetector] Authentication failed for ${channel.name}: ${res.statusCode} - ${errorMessage}`);
              resolve({
                models: [],
                supported: true,
                cached: false,
                fallbackUsed: true,
                error: errorMessage,
                errorHint: errorHint,
                statusCode: res.statusCode
              });
            } else {
              errorMessage = '访问被拒绝';
              errorHint = '请检查 API 密钥权限或联系服务提供商';
              console.error(`[ModelDetector] Access denied for ${channel.name}: ${res.statusCode} - ${errorMessage}`);
              resolve({
                models: [],
                supported: true,
                cached: false,
                fallbackUsed: true,
                error: errorMessage,
                errorHint: errorHint,
                statusCode: res.statusCode
              });
            }
            } else if (res.statusCode === 404) {
              console.warn(`[ModelDetector] Model list endpoint not found for ${channel.name}`);
              resolve({
                models: [],
                supported: false,
                cached: false,
                fallbackUsed: true,
                error: '模型列表端点不存在',
                errorHint: '该 API 可能不支持 /v1/models 接口，请手动输入模型名称',
                statusCode: 404
              });
            } else if (res.statusCode === 429) {
              console.warn(`[ModelDetector] Rate limited for ${channel.name}`);
              resolve({
                models: [],
                supported: true,
                cached: false,
                fallbackUsed: true,
                error: '请求频率限制',
                errorHint: '请稍后再试或联系服务提供商提高限额',
                statusCode: 429
              });
            } else {
              console.error(`[ModelDetector] Unexpected status ${res.statusCode} for ${channel.name}`);
              resolve({
                models: [],
                supported: true,
                cached: false,
                fallbackUsed: true,
                error: `HTTP 错误 ${res.statusCode}`,
                errorHint: '请检查 API 端点配置或联系服务提供商',
                statusCode: res.statusCode
              });
            }
          })
          .catch((error) => {
            console.error(`[ModelDetector] Failed to read models response: ${error.message}`);
            resolve({
              models: [],
              supported: true,
              cached: false,
              fallbackUsed: true,
              error: `Read error: ${error.message}`
            });
          });
      });

      req.on('error', (error) => {
        console.error(`[ModelDetector] Network error fetching models from ${channel.name}: ${error.message}`);
        resolve({
          models: [],
          supported: true,
          cached: false,
          fallbackUsed: true,
          error: `Network error: ${error.message}`
        });
      });

      req.on('timeout', () => {
        req.destroy();
        console.error(`[ModelDetector] Timeout fetching models from ${channel.name}`);
        resolve({
          models: [],
          supported: true,
          cached: false,
          fallbackUsed: true,
          error: 'Request timeout'
        });
      });

      req.end();

    } catch (error) {
      console.error(`[ModelDetector] Error in fetchModelsFromProvider: ${error.message}`);
      resolve({
        models: [],
        supported: true,
        cached: false,
        fallbackUsed: true,
        error: error.message
      });
    }
  });
}

module.exports = {
  probeModelAvailability,
  testModelAvailability,
  getModelPriority,
  normalizeModelName,
  clearCache,
  getCachedModelInfo,
  fetchModelsFromProvider,
  detectChannelType,
  MODEL_PRIORITY
};
