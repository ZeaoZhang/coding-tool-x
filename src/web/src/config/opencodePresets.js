/**
 * OpenCode 预设配置
 * 支持多种 LLM provider 和 OAuth 登录
 */

export const opencodePresets = [
  // ============================================
  // OAuth 登录提供商
  // ============================================
  {
    id: 'github_copilot',
    name: 'GitHub Copilot',
    category: 'oauth',
    description: 'GitHub Copilot 通过 OAuth 设备流登录',
    websiteUrl: 'https://github.com/features/copilot',
    baseUrl: 'https://api.githubcopilot.com',
    wireApi: 'openai',
    authType: 'oauth',
    oauthProvider: 'github_copilot',
    models: ['gpt-4o', 'gpt-4-turbo', 'claude-3.5-sonnet']
  },
  {
    id: 'openai_chatgpt',
    name: 'OpenAI ChatGPT Plus/Pro',
    category: 'oauth',
    description: '使用 ChatGPT Plus/Pro 订阅登录',
    websiteUrl: 'https://chat.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    wireApi: 'openai',
    authType: 'oauth',
    oauthProvider: 'openai_chatgpt',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini']
  },
  {
    id: 'anthropic_claude',
    name: 'Anthropic Claude Pro/Max',
    category: 'oauth',
    description: '使用 Claude Pro/Max 订阅登录',
    websiteUrl: 'https://claude.ai',
    baseUrl: 'https://api.anthropic.com/v1',
    wireApi: 'anthropic',
    authType: 'oauth',
    oauthProvider: 'anthropic_claude',
    models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku']
  },
  {
    id: 'gitlab_duo',
    name: 'GitLab Duo',
    category: 'oauth',
    description: 'GitLab Duo AI 功能',
    websiteUrl: 'https://about.gitlab.com/solutions/ai/',
    baseUrl: 'https://gitlab.com/api/v4/ai',
    wireApi: 'openai',
    authType: 'oauth',
    oauthProvider: 'gitlab_duo',
    models: ['claude-3-sonnet', 'claude-3-haiku']
  },

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
    authType: 'apiKey',
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
    authType: 'apiKey',
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
    authType: 'apiKey',
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
    authType: 'apiKey',
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
    authType: 'apiKey',
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
    authType: 'apiKey',
    models: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1']
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
    authType: 'apiKey',
    models: []
  }
]

export const opencodePresetCategories = {
  oauth: 'OAuth 登录',
  apikey: 'API Key',
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

/**
 * 获取所有 OAuth 提供商
 * @returns {array}
 */
export function getOAuthPresets() {
  return opencodePresets.filter(p => p.authType === 'oauth')
}
