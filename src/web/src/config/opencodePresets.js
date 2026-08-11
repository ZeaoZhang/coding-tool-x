/**
 * OpenCode 预设配置
 */

export const opencodePresets = [
  // ============================================
  // API Key 提供商
  // ============================================
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'apikey',
    description: '统一接口访问 200+ 模型',
    websiteUrl: 'https://openrouter.ai',
    baseUrl: 'https://openrouter.ai/api/v1',
    wireApi: 'openai',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'meta-llama/llama-3.1-405b']
  },
  {
    id: 'openai_api',
    name: 'OpenAI API',
    category: 'apikey',
    description: 'OpenAI 官方 API（需要 API Key）',
    websiteUrl: 'https://platform.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    wireApi: 'openai',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'gpt-4-turbo']
  },
  {
    id: 'anthropic_api',
    name: 'Anthropic API',
    category: 'apikey',
    description: 'Anthropic 官方 API（需要 API Key）',
    websiteUrl: 'https://console.anthropic.com',
    baseUrl: 'https://api.anthropic.com/v1',
    wireApi: 'anthropic',
    models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'apikey',
    description: 'DeepSeek AI 模型',
    websiteUrl: 'https://platform.deepseek.com',
    baseUrl: 'https://api.deepseek.com/v1',
    wireApi: 'openai',
    models: ['deepseek-chat', 'deepseek-coder']
  },
  {
    id: 'groq',
    name: 'Groq',
    category: 'apikey',
    description: '超快推理速度',
    websiteUrl: 'https://console.groq.com',
    baseUrl: 'https://api.groq.com/openai/v1',
    wireApi: 'openai',
    models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']
  },
  {
    id: 'together',
    name: 'Together AI',
    category: 'apikey',
    description: '开源模型托管',
    websiteUrl: 'https://www.together.ai',
    baseUrl: 'https://api.together.xyz/v1',
    wireApi: 'openai',
    models: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1']
  },

  // ============================================
  // 转换入口（请求格式入口）
  // ============================================
  {
    id: 'entry_claude',
    name: 'Claude Code 入口',
    category: 'entry',
    description: '渠道按 Claude Code 请求入口管理',
    websiteUrl: '',
    baseUrl: '',
    wireApi: 'openai',
    gatewaySourceType: 'claude',
    providerApi: 'anthropic-messages',
    models: []
  },
  {
    id: 'entry_codex',
    name: 'Codex 入口',
    category: 'entry',
    description: '渠道按 Codex 请求入口管理',
    websiteUrl: '',
    baseUrl: '',
    wireApi: 'openai',
    providerApi: 'responses',
    gatewaySourceType: 'codex',
    models: []
  },
  {
    id: 'entry_gemini',
    name: 'Gemini 入口',
    category: 'entry',
    description: '渠道按 Gemini 请求入口管理',
    websiteUrl: '',
    baseUrl: '',
    wireApi: 'openai',
    gatewaySourceType: 'gemini',
    providerApi: 'google-generative-ai',
    models: []
  },

  // Completions vs Responses 入口
  {
    id: 'entry_responses',
    name: 'Responses 入口',
    category: 'entry',
    description: '渠道按 OpenAI Responses 请求入口管理（非 Codex）',
    websiteUrl: '',
    baseUrl: '',
    wireApi: 'openai',
    providerApi: 'responses',
    gatewaySourceType: 'openai_compatible',
    models: []
  },

  // ============================================
  // 自定义
  // ============================================
  {
    id: 'custom',
    name: '自定义',
    category: 'custom',
    description: '自定义 OpenAI 兼容的 API 端点',
    websiteUrl: '',
    baseUrl: '',
    wireApi: 'openai',
    models: []
  }
]

export const opencodePresetCategories = {
  apikey: 'API Key',
  entry: '转换入口',
  custom: '自定义'
}

/**
 * 根据 ID 获取预设
 * @param {string} id
 * @returns {object|undefined}
 */
export function getOpenCodePresetById(id) {
  return opencodePresets.find(p => p.id === id)
}

/**
 * 根据分类获取预设列表
 * @param {string} category
 * @returns {array}
 */
export function getOpenCodePresetsByCategory(category) {
  return opencodePresets.filter(p => p.category === category)
}
