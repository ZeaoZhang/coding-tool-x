import { ref } from 'vue';

// Module-level reactive ref for caching
const defaultModels = ref(null);
const loading = ref(false);

// Built-in fallback defaults (same as backend DEFAULT_CONFIG)
const FALLBACK_MODELS = {
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
  ],
  opencode: [
    'gpt-4o',
    'gpt-4o-mini',
    'claude-3-5-sonnet',
    'claude-3-opus',
    'deepseek-chat'
  ]
};

// Promise cache for concurrent calls
let fetchPromise = null;

/**
 * Load default models from backend API
 * Lazy loading: fetch on first call, cache thereafter
 * Handles concurrent calls by returning the same promise
 * @returns {Promise<Object>} Default models configuration
 */
async function loadDefaultModels() {
  // If already loaded, return cached value
  if (defaultModels.value) return defaultModels.value;

  // If currently loading, return the existing promise
  if (fetchPromise) return fetchPromise;

  // Start new fetch
  loading.value = true;
  fetchPromise = (async () => {
    try {
      const response = await fetch('/api/config/default-models');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      defaultModels.value = data.defaultModels;
    } catch (error) {
      console.warn('Failed to load default models, using fallback:', error);
      defaultModels.value = FALLBACK_MODELS;
    } finally {
      loading.value = false;
      fetchPromise = null;
    }
    return defaultModels.value;
  })();

  return fetchPromise;
}

/**
 * Get default models for a specific tool type
 * @param {string} toolType - Tool type: 'claude', 'codex', 'gemini', 'opencode'
 * @returns {Array<string>} Array of model names
 */
function getDefaultModels(toolType) {
  return defaultModels.value?.[toolType] || FALLBACK_MODELS[toolType] || [];
}

/**
 * Composable for managing default models configuration
 * @returns {Object} API for accessing default models
 */
export function useDefaultModels() {
  return {
    defaultModels,
    loading,
    loadDefaultModels,
    getDefaultModels
  };
}
