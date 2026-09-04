import { ref } from 'vue';

// Module-level reactive ref for caching
const defaultModels = ref(null);
const allModels = ref(null);
const loading = ref(false);

// 与后端默认配置保持一致的内置模型列表
const FALLBACK_MODELS = {
  claude: [
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001'
  ],
  codex: [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
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
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ],
  opencode: [],
  omp: []
};

const TOOL_TYPES = ['claude', 'codex', 'gemini', 'opencode', 'omp'];

function normalizeModelList(models = []) {
  const seen = new Set();
  const normalized = [];
  models.forEach((model) => {
    if (typeof model !== 'string') return;
    const trimmed = model.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });
  return normalized;
}

function classifyToolTypeByModelId(modelId) {
  const id = String(modelId || '').trim().toLowerCase();
  if (id.startsWith('claude-')) return 'claude';
  if (id.startsWith('gemini-')) return 'gemini';
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return 'codex';
  return '';
}

export function buildAllModelsFromMetadata(modelsMap, explicitToolModels = {}) {
  const grouped = Object.fromEntries(TOOL_TYPES.map(toolType => [toolType, []]));
  const hasExplicitGroups = TOOL_TYPES.some(toolType => (
    Array.isArray(explicitToolModels?.[toolType])
  ));

  if (hasExplicitGroups) {
    for (const toolType of TOOL_TYPES) {
      grouped[toolType] = normalizeModelList(explicitToolModels[toolType] || []);
    }
    return grouped;
  }

  for (const [modelId, meta] of Object.entries(modelsMap || {})) {
    if (!meta || typeof meta !== 'object' || !meta.limit || !meta.pricing) continue;
    const declaredToolTypes = Array.isArray(meta.toolTypes)
      ? meta.toolTypes
      : [classifyToolTypeByModelId(modelId)];
    for (const toolType of declaredToolTypes) {
      if (TOOL_TYPES.includes(toolType)) grouped[toolType].push(modelId);
    }
  }

  return Object.fromEntries(TOOL_TYPES.map(toolType => [
    toolType,
    normalizeModelList(grouped[toolType])
  ]));
}

function cloneFallbackModels() {
  return Object.fromEntries(TOOL_TYPES.map(toolType => [
    toolType,
    [...(FALLBACK_MODELS[toolType] || [])]
  ]));
}

// Promise cache for concurrent calls
let fetchPromise = null;

/**
 * Load default models from backend API
 * Lazy loading: fetch on first call, cache thereafter
 * Handles concurrent calls by returning the same promise
 * @returns {Promise<Object>} Default models configuration
 */
async function loadDefaultModels(options = {}) {
  const forceRefresh = options.forceRefresh === true;

  // If already loaded, return cached value
  if (!forceRefresh && defaultModels.value && allModels.value) return defaultModels.value;

  // If currently loading, return the existing promise
  if (fetchPromise) return fetchPromise;

  // Start new fetch
  loading.value = true;
  fetchPromise = (async () => {
    try {
      const params = new URLSearchParams();
      if (forceRefresh) params.set('forceRefresh', 'true');
      const query = params.toString();
      const url = query ? `/api/config/default-models?${query}` : '/api/config/default-models';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      defaultModels.value = data.defaultModels;

      try {
        const metadataResponse = await fetch('/api/settings/model-settings');
        if (!metadataResponse.ok) {
          throw new Error(`HTTP ${metadataResponse.status}: ${metadataResponse.statusText}`);
        }
        const metadataData = await metadataResponse.json();
        const metadataModels = buildAllModelsFromMetadata(
          metadataData.models || {},
          metadataData.toolModels || {}
        );
        allModels.value = Object.fromEntries(TOOL_TYPES.map(toolType => [
          toolType,
          metadataModels[toolType].length > 0
            ? metadataModels[toolType]
            : [...(FALLBACK_MODELS[toolType] || [])]
        ]));
      } catch (metadataError) {
        console.warn('Failed to load model metadata list, using fallback:', metadataError);
        allModels.value = cloneFallbackModels();
      }
    } catch (error) {
      console.warn('Failed to load default models, using fallback:', error);
      defaultModels.value = FALLBACK_MODELS;
      allModels.value = cloneFallbackModels();
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
 * @param {string} toolType - Tool type: 'claude', 'codex', 'gemini'
 * @returns {Array<string>} Array of model names
 */
function getDefaultModels(toolType) {
  const explicitModels = defaultModels.value?.[toolType];
  if (Array.isArray(explicitModels) && explicitModels.length > 0) return explicitModels;

  const dynamicModels = allModels.value?.[toolType];
  if (Array.isArray(dynamicModels) && dynamicModels.length > 0) return dynamicModels;

  return FALLBACK_MODELS[toolType] || [];
}

function getAllModelsByToolType(toolType) {
  return allModels.value?.[toolType] || FALLBACK_MODELS[toolType] || [];
}

/**
 * Composable for managing default models configuration
 * @returns {Object} API for accessing default models
 */
export function useDefaultModels() {
  return {
    defaultModels,
    allModels,
    loading,
    loadDefaultModels,
    getDefaultModels,
    getAllModelsByToolType
  };
}
