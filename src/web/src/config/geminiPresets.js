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
    authType: 'apiKey'
  },
  {
    id: 'google_oauth',
    name: 'Google OAuth',
    category: 'official',
    websiteUrl: 'https://ai.google.dev',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'oauth'
  },
  {
    id: 'custom',
    name: '自定义',
    category: 'custom',
    websiteUrl: '',
    baseUrl: '',
    authType: 'apiKey'
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
