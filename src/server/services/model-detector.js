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

// Model priority by channel type
const MODEL_PRIORITY = {
  claude: [
    'claude-haiku-3-5-20241022',
    'claude-3-5-haiku-20241022',
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-20250514'
  ],
  codex: ['gpt-4o-mini', 'gpt-4o', 'gpt-5-codex', 'o3'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro']
};

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
      let headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Coding-Tool-ModelDetector/1.0'
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
      } else if (channelType === 'codex') {
        testUrl = `${baseUrl}/v1/chat/completions`;
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
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          // Success: 200-299 status codes
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
          } else if (res.statusCode === 400 || res.statusCode === 404) {
            // 400/404 often means model not found or invalid
            try {
              const response = JSON.parse(data);
              const errorMsg = (response.error?.message || '').toLowerCase();

              // Check for model-specific errors
              if (errorMsg.includes('model') &&
                  (errorMsg.includes('not found') || errorMsg.includes('invalid') || errorMsg.includes('does not exist'))) {
                resolve(false);
              } else {
                // Other 400 errors might be auth/validation issues, not model issues
                resolve(true);
              }
            } catch {
              resolve(false);
            }
          } else {
            // Other errors (401, 403, 500, etc.) are inconclusive
            resolve(false);
          }
        });
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
async function probeModelAvailability(channel, channelType) {
  const cache = loadModelCache();
  const cacheKey = channel.id;

  // Return cached result if valid
  if (cache[cacheKey] && isCacheValid(cache[cacheKey])) {
    return {
      availableModels: cache[cacheKey].availableModels || [],
      preferredTestModel: cache[cacheKey].preferredTestModel || null,
      cached: true,
      lastChecked: cache[cacheKey].lastChecked
    };
  }

  // Get model priority list for this channel type
  const modelsToTest = MODEL_PRIORITY[channelType] || [];
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

  // Test models in priority order
  for (const model of modelsToTest) {
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
  // If no type specified or type is 'claude', auto-detect
  if (!channelType || channelType === 'claude') {
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
      const endpoint = capability.modelListEndpoint;
      const requestUrl = `${baseUrl}${endpoint}`;

      const parsedUrl = new URL(requestUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const headers = {
        'User-Agent': 'Coding-Tool-ModelDetector/1.0',
        'Accept': 'application/json'
      };

      // Add authentication header
      if (capability.authHeader && channel.apiKey) {
        headers['Authorization'] = `Bearer ${channel.apiKey}`;
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
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
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
              errorMessage = 'Cloudflare 防护拦截，已使用默认模型';
              errorHint = '该 API 端点受 Cloudflare 保护，已自动使用默认模型 claude-sonnet-4-5';
              console.warn(`[ModelDetector] Cloudflare protection detected for ${channel.name}, using default model`);
              resolve({
                models: ['claude-sonnet-4-5'],
                supported: true,
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
  normalizeModelName,
  clearCache,
  getCachedModelInfo,
  fetchModelsFromProvider,
  detectChannelType,
  MODEL_PRIORITY
};
