/**
 * Gemini 渠道预设配置
 */

export const geminiPresets = [
  {
    id: 'google',
    name: 'Google AI',
    category: 'official',
    websiteUrl: 'https://ai.google.dev',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiFormat: 'gemini_api'
  },
  {
    id: 'vertex_ai_v1',
    name: 'Vertex AI v1',
    category: 'official',
    websiteUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs',
    baseUrl: 'https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/LOCATION/publishers/google',
    apiFormat: 'vertex_ai_v1'
  },
  {
    id: 'custom',
    name: '自定义',
    category: 'custom',
    websiteUrl: '',
    baseUrl: '',
    apiFormat: 'gemini_api'
  }
]

// 预设分类
export const geminiPresetCategories = {
  official: '官方',
  custom: '自定义'
}

// 根据 ID 获取预设
export function getGeminiPresetById(id) {
  return geminiPresets.find(p => p.id === id)
}
