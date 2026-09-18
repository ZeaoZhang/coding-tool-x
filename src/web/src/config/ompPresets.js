export const ompPresets = [
  // API Key providers. Keep this list owned by OMP so OpenCode-only OAuth
  // presets cannot leak into the OMP channel selector.
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

  // Request-format entry points.
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
    providerApi: 'google-generative-ai',
    gatewaySourceType: 'gemini',
    models: []
  },
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

  {
    id: 'custom',
    name: '自定义',
    category: 'custom',
    description: '自定义 OpenAI 兼容的 API 端点',
    websiteUrl: '',
    baseUrl: '',
    wireApi: 'openai',
    models: []
  },

  // OMP OAuth is intentionally separate from OpenCode OAuth.
  {
    id: 'omp_oauth',
    name: 'OMP OAuth',
    category: 'oauth',
    description: '使用本地 OMP broker OAuth 登录凭据',
    websiteUrl: '',
    baseUrl: '',
    providerKey: 'omp-oauth',
    authMode: 'oauth',
    oauthProviderId: ''
  },
  {
    id: 'omp_oauth_gateway',
    name: 'OMP OAuth Auth Gateway',
    category: 'oauth',
    description: '通过健康的 pi-native Auth Gateway 转发 OMP broker OAuth 登录态',
    websiteUrl: '',
    baseUrl: '',
    wireApi: 'openai',
    providerApi: 'openai-completions',
    gatewaySourceType: 'openai_compatible',
    transport: 'pi-native',
    authMode: 'oauth',
    oauthProviderId: '',
    models: []
  }
]

export const ompPresetCategories = {
  apikey: 'API Key',
  entry: '转换入口',
  oauth: 'OAuth',
  custom: '自定义'
}

export function getOmpPresetById(id) {
  return ompPresets.find(preset => preset.id === id)
}

export function getOmpPresetsByCategory(category) {
  return ompPresets.filter(preset => preset.category === category)
}
