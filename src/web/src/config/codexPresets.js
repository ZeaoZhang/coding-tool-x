/**
 * Codex 渠道预设配置
 */

export const codexPresets = [
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'official',
    websiteUrl: 'https://platform.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    providerKey: 'openai',
    authType: 'apiKey'
  },
  {
    id: 'openai_oauth',
    name: 'OpenAI OAuth',
    category: 'official',
    websiteUrl: 'https://platform.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    providerKey: 'openai',
    authType: 'oauth'
  },
  {
    id: 'custom',
    name: '自定义',
    category: 'custom',
    websiteUrl: '',
    baseUrl: '',
    providerKey: '',
    authType: 'apiKey'
  }
]

// 预设分类
export const codexPresetCategories = {
  official: '官方',
  custom: '自定义'
}

// 根据 ID 获取预设
export function getCodexPresetById(id) {
  return codexPresets.find(p => p.id === id)
}
