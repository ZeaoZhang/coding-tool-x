/**
 * Model Detector Service
 * Probes model availability for channels and caches results
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const zlib = require('zlib');
const { loadConfig } = require('../../config/loader');
const { HOME_DIR } = require('../../config/paths');

// 内置模型优先级（当配置缺失时兜底）
const MODEL_PRIORITY = {
  claude: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001'
  ],
  codex: [
    'gpt-5.4',
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex',
    'gpt-5.1-codex-mini',
    'gpt-5-codex',
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5'
  ],
  gemini: [
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
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
        return normalizeModelCandidates(models);
      }
    }
  } catch (error) {
    console.warn(`[ModelDetector] Failed to load default models config: ${error.message}`);
  }

  return [];
}

function getModelDiscoveryConfig() {
  try {
    const config = loadConfig();
    return {
      useV1ModelsEndpoint: config?.modelDiscovery?.useV1ModelsEndpoint === true
    };
  } catch (error) {
    console.warn(`[ModelDetector] Failed to load modelDiscovery config: ${error.message}`);
    return {
      useV1ModelsEndpoint: false
    };
  }
}

function shouldUseV1ModelsEndpoint(options = {}) {
  if (typeof options.useV1ModelsEndpoint === 'boolean') {
    return options.useV1ModelsEndpoint;
  }
  return getModelDiscoveryConfig().useV1ModelsEndpoint;
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
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-4-6-sonnet': 'claude-sonnet-4-6',
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

const TEST_TIMEOUT_MS = 10000; // 10 seconds per model test
const CLAUDE_CODE_BETA_HEADER = 'claude-code-20250219,interleaved-thinking-2025-05-14';

const MODEL_UNAVAILABLE_HINTS = [
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
  '模型不可用',
  '请切换'
];

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

function buildOpenAiCompatibleUrl(baseUrl, endpoint) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Invalid baseUrl');
  }

  const normalizedEndpoint = String(endpoint || '').startsWith('/')
    ? String(endpoint)
    : `/${endpoint}`;

  if (trimmed.endsWith(normalizedEndpoint)) {
    return trimmed;
  }

  const endpointWithoutV1 = normalizedEndpoint.startsWith('/v1/')
    ? normalizedEndpoint.slice(3)
    : normalizedEndpoint;

  if (trimmed.endsWith(endpointWithoutV1)) {
    return trimmed;
  }

  if (trimmed.endsWith('/v1') && normalizedEndpoint.startsWith('/v1/')) {
    return `${trimmed}${normalizedEndpoint.slice(3)}`;
  }

  return `${trimmed}${normalizedEndpoint}`;
}

function buildClaudeMessagesUrl(baseUrl, options = {}) {
  const withBeta = options.withBeta !== false;
  const parsed = new URL(String(baseUrl || '').trim());
  let pathname = parsed.pathname.replace(/\/+$/, '');

  if (!pathname || pathname === '/') {
    pathname = '/v1/messages';
  } else if (pathname.endsWith('/messages')) {
    // noop
  } else if (pathname.endsWith('/v1')) {
    pathname = `${pathname}/messages`;
  } else {
    pathname = `${pathname}/v1/messages`;
  }

  parsed.pathname = pathname;
  if (withBeta) {
    parsed.searchParams.set('beta', 'true');
  }
  return parsed.toString();
}

function buildGeminiGenerateContentUrl(baseUrl, model, apiKey = '') {
  const modelName = String(model || '').trim();
  if (!modelName) {
    throw new Error('Model is required for Gemini probe');
  }

  const parsed = new URL(String(baseUrl || '').trim());
  let pathname = parsed.pathname.replace(/\/+$/, '');
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

  parsed.pathname = `${apiBasePath}/models/${encodeURIComponent(modelName)}:generateContent`;
  if (apiKey) {
    parsed.searchParams.set('key', apiKey);
  }
  return parsed.toString();
}

function buildClaudeProbePayload(model, options = {}) {
  const includeSystem = options.includeSystem === true;
  const systemAsArray = options.systemAsArray === true;
  const includeMetadata = options.includeMetadata === true;
  const sessionId = Math.random().toString(36).substring(2, 15);

  const payload = {
    model,
    max_tokens: 1,
    stream: false,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }]
  };

  if (includeSystem) {
    const systemPrompt = "You are Claude Code, Anthropic's official CLI for Claude.";
    payload.system = systemAsArray
      ? [{ type: 'text', text: systemPrompt }]
      : systemPrompt;
  }

  if (includeMetadata) {
    payload.metadata = {
      user_id: `user_0000000000000000000000000000000000000000000000000000000000000000_account__session_${sessionId}`
    };
  }

  return JSON.stringify(payload);
}

function createClaudeProbeAttempts(channel, model) {
  const apiKey = channel.apiKey || '';
  const commonHeaders = {
    ...buildRequestHeaders('claude', channel),
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': CLAUDE_CODE_BETA_HEADER,
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': 'claude-cli/2.0.53 (external, cli)'
  };

  const legacyBody = buildClaudeProbePayload(model, {
    includeSystem: true,
    systemAsArray: true,
    includeMetadata: true
  });

  return [
    {
      label: 'claude-code-legacy-beta',
      url: buildClaudeMessagesUrl(channel.baseUrl, { withBeta: true }),
      body: legacyBody,
      headers: {
        ...commonHeaders,
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-app': 'cli',
        'x-stainless-lang': 'js',
        'x-stainless-runtime': 'node'
      }
    }
  ];
}

function createCodexProbeAttempts(channel, model) {
  const apiKey = channel.apiKey || '';
  const commonHeaders = {
    ...buildRequestHeaders('codex', channel),
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'User-Agent': 'codex_cli_rs/0.65.0'
  };

  const responsesBody = JSON.stringify({
    model,
    instructions: 'You are Codex.',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
    max_output_tokens: 1,
    stream: false,
    store: false
  });

  return [
    {
      label: 'codex-responses',
      url: buildOpenAiCompatibleUrl(channel.baseUrl, '/v1/responses'),
      body: responsesBody,
      headers: {
        ...commonHeaders,
        'openai-beta': 'responses=experimental'
      }
    }
  ];
}

function createGeminiProbeAttempt(channel, model) {
  const apiKey = channel.apiKey || '';
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'test' }] }],
    generationConfig: { maxOutputTokens: 1, temperature: 0 }
  });

  return {
    label: 'gemini-generate-content',
    url: buildGeminiGenerateContentUrl(channel.baseUrl, model, apiKey),
    body,
    headers: {
      ...buildRequestHeaders('gemini', channel),
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-goog-api-key': apiKey,
      'User-Agent': 'google-genai-sdk/0.8.0'
    }
  };
}

function buildProbeAttempts(channel, channelType, model) {
  const normalizedType = String(channelType || '').trim().toLowerCase();
  if (normalizedType === 'claude') {
    return createClaudeProbeAttempts(channel, model);
  }
  if (normalizedType === 'codex' || normalizedType === 'openai_compatible') {
    return createCodexProbeAttempts(channel, model);
  }
  if (normalizedType === 'gemini') {
    return [createGeminiProbeAttempt(channel, model)];
  }
  return [];
}

function extractProbeErrorMessage(responseBody) {
  const fallback = String(responseBody || '');
  try {
    const response = JSON.parse(responseBody || '{}');
    if (typeof response === 'string') return response;
    if (typeof response?.error?.message === 'string') return response.error.message;
    if (typeof response?.error === 'string') return response.error;
    if (typeof response?.message === 'string') return response.message;
    if (typeof response?.detail === 'string') return response.detail;
    return fallback;
  } catch {
    return fallback;
  }
}

function classifyProbeResult(statusCode, responseBody, model) {
  if (statusCode >= 200 && statusCode < 300) {
    return 'available';
  }

  const errorMsg = extractProbeErrorMessage(responseBody).toLowerCase();
  const modelLower = String(model || '').toLowerCase();
  const hasModelContext = errorMsg.includes('model')
    || errorMsg.includes('模型')
    || (modelLower && errorMsg.includes(modelLower));

  if (hasModelContext && MODEL_UNAVAILABLE_HINTS.some(hint => errorMsg.includes(hint))) {
    return 'unavailable';
  }

  if (statusCode === 400 || statusCode === 404 || statusCode === 405 || statusCode === 415 || statusCode === 422 || statusCode === 501) {
    return 'retry';
  }

  return 'retry';
}

function sanitizeProbeErrorMessage(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function buildProbeFailureDetail(attempt, result) {
  if (!attempt || !result) return null;
  const statusCode = Number(result.statusCode) || 0;
  const message = result.error?.message
    ? sanitizeProbeErrorMessage(result.error.message)
    : sanitizeProbeErrorMessage(extractProbeErrorMessage(result.responseBody));

  return {
    attempt: attempt.label || 'unknown',
    statusCode,
    message
  };
}

function formatProbeFailureDetail(detail) {
  if (!detail) return '';
  const parts = [];
  if (detail.attempt) parts.push(`attempt=${detail.attempt}`);
  if (detail.statusCode) parts.push(`status=${detail.statusCode}`);
  if (detail.message) parts.push(`msg=${detail.message}`);
  if (parts.length === 0) return '';
  return ` (${parts.join(', ')})`;
}

function executeProbeAttempt(attempt) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(attempt.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      const requestBody = String(attempt.body || '');
      const headers = {
        ...(attempt.headers || {}),
        'Content-Length': Buffer.byteLength(requestBody)
      };

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        timeout: TEST_TIMEOUT_MS,
        headers
      };

      const req = httpModule.request(options, (res) => {
        collectResponseBody(res)
          .then((data) => {
            resolve({
              statusCode: res.statusCode || 0,
              responseBody: data
            });
          })
          .catch((error) => {
            resolve({
              statusCode: 0,
              responseBody: '',
              error
            });
          });
      });

      req.on('error', (error) => resolve({
        statusCode: 0,
        responseBody: '',
        error
      }));
      req.on('timeout', () => {
        req.destroy();
        resolve({
          statusCode: 0,
          responseBody: '',
          error: new Error('Request timeout')
        });
      });

      req.write(requestBody);
      req.end();
    } catch (error) {
      resolve({
        statusCode: 0,
        responseBody: '',
        error
      });
    }
  });
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
  const dir = path.join(HOME_DIR, '.cc-tool');
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

function normalizeModelCandidates(models = []) {
  if (!Array.isArray(models)) return [];
  const seen = new Set();
  const normalized = [];

  models.forEach((model) => {
    if (typeof model !== 'string') return;
    const trimmed = model.trim();
    if (!trimmed) return;
    const canonical = normalizeModelName(trimmed) || trimmed;
    const dedupeKey = canonical.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push(canonical);
  });

  return normalized;
}

/**
 * Stable stringify with key ordering to build deterministic cache signatures
 */
function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  if (typeof value !== 'object') return JSON.stringify(value);

  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function buildChannelCacheSignature(channel, payload = {}) {
  const base = {
    id: channel?.id || '',
    name: channel?.name || '',
    baseUrl: channel?.baseUrl || '',
    apiKey: channel?.apiKey || '',
    gatewaySourceType: channel?.gatewaySourceType || '',
    wireApi: channel?.wireApi || '',
    model: channel?.model || '',
    speedTestModel: channel?.speedTestModel || '',
    presetId: channel?.presetId || '',
    modelConfig: channel?.modelConfig || null,
    modelRedirects: Array.isArray(channel?.modelRedirects) ? channel.modelRedirects : []
  };
  const raw = stableStringify({
    channel: base,
    payload
  });

  return crypto.createHash('sha1').update(raw).digest('hex');
}

function isSignatureCacheValid(cacheEntry, signatureKey, expectedSignature) {
  if (!cacheEntry || !signatureKey || !expectedSignature) return false;
  return cacheEntry[signatureKey] === expectedSignature;
}

/**
 * Test if a specific model is available for a channel
 * @param {Object} channel - Channel configuration
 * @param {string} channelType - 'claude' | 'codex' | 'gemini'
 * @param {string} model - Model name to test
 * @returns {Promise<boolean>}
 */
async function testModelAvailabilityDetailed(channel, channelType, model) {
  try {
    const attempts = buildProbeAttempts(channel, channelType, model);
    if (!attempts.length) {
      return { available: false, failureDetail: null };
    }

    let failureDetail = null;
    for (const attempt of attempts) {
      const result = await executeProbeAttempt(attempt);
      if (result.error) {
        if (!failureDetail) {
          failureDetail = buildProbeFailureDetail(attempt, result);
        }
        continue;
      }

      const verdict = classifyProbeResult(result.statusCode, result.responseBody, model);
      if (verdict === 'available') {
        return { available: true, failureDetail: null };
      }

      if (!failureDetail) {
        failureDetail = buildProbeFailureDetail(attempt, result);
      }
      if (verdict === 'unavailable') {
        return { available: false, failureDetail };
      }
    }

    return { available: false, failureDetail };
  } catch {
    return { available: false, failureDetail: null };
  }
}

async function testModelAvailability(channel, channelType, model) {
  const result = await testModelAvailabilityDetailed(channel, channelType, model);
  return result.available;
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
  const stopOnFirstAvailable = !!options.stopOnFirstAvailable;
  const cache = loadModelCache();
  const cacheKey = channel.id;
  const preferredModels = normalizeModelCandidates(options.preferredModels);
  const probeSignature = buildChannelCacheSignature(channel, {
    type: 'probe',
    channelType: String(channelType || '').trim().toLowerCase(),
    toolType: String(toolType || '').trim().toLowerCase(),
    stopOnFirstAvailable,
    preferredModels
  });

  // Return cached result if channel and probe options are unchanged
  if (!forceRefresh && isSignatureCacheValid(cache[cacheKey], 'probeSignature', probeSignature)) {
    return {
      availableModels: cache[cacheKey].availableModels || [],
      preferredTestModel: cache[cacheKey].preferredTestModel || null,
      cached: true,
      lastChecked: cache[cacheKey].lastChecked
    };
  }

  // Get model priority list for this channel type
  const priorityModels = normalizeModelCandidates(getModelPriority(channelType, { toolType }));
  const modelsToTest = normalizeModelCandidates([...preferredModels, ...priorityModels]);
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

    const probeResult = await testModelAvailabilityDetailed(channel, channelType, model);
    const isAvailable = probeResult.available;

    if (isAvailable) {
      availableModels.push(model);
      console.log(`[ModelDetector] ✓ ${model} available`);
      if (stopOnFirstAvailable) {
        break;
      }
    } else {
      console.log(`[ModelDetector] ✗ ${model} not available${formatProbeFailureDetail(probeResult.failureDetail)}`);
    }
  }

  const preferredTestModel = availableModels.length > 0 ? availableModels[0] : null;

  // Update cache
  const cacheEntry = {
    lastChecked: new Date().toISOString(),
    availableModels,
    preferredTestModel,
    probeSignature,
    fetchedModels: cache[cacheKey]?.fetchedModels || [],
    listSignature: cache[cacheKey]?.listSignature || null
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

  if (entry && (Array.isArray(entry.availableModels) || Array.isArray(entry.fetchedModels))) {
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
async function fetchModelsFromProvider(channel, channelType, options = {}) {
  const forceRefresh = !!options.forceRefresh;
  const useV1ModelsEndpoint = shouldUseV1ModelsEndpoint(options);
  // Only auto-detect if channelType is NOT specified at all
  // DO NOT auto-detect when channelType is 'claude' - respect the caller's intent
  if (!channelType) {
    channelType = detectChannelType(channel);
    console.log(`[ModelDetector] Auto-detected channel type: ${channelType} for ${channel.name}`);
  }

  if (!useV1ModelsEndpoint) {
    return {
      models: [],
      supported: true,
      fallbackUsed: true,
      cached: false,
      disabledByConfig: true,
      error: '已关闭 /v1/models 模型列表探测',
      errorHint: '当前使用默认模型探测策略'
    };
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
  const listSignature = buildChannelCacheSignature(channel, {
    type: 'model-list',
    channelType: String(channelType || '').trim().toLowerCase()
  });

  // Check cache first, and only reuse when channel/list context is unchanged
  if (!forceRefresh
    && isSignatureCacheValid(cache[cacheKey], 'listSignature', listSignature)
    && Array.isArray(cache[cacheKey].fetchedModels)) {
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
                  preferredTestModel: cache[cacheKey]?.preferredTestModel || null,
                  probeSignature: cache[cacheKey]?.probeSignature || null,
                  listSignature
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
