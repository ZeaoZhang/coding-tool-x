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

module.exports = {
  probeModelAvailability,
  testModelAvailability,
  normalizeModelName,
  clearCache,
  getCachedModelInfo,
  MODEL_PRIORITY
};
