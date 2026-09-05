import { opencodePresets } from './opencodePresets'

export const ompPresets = [
  ...opencodePresets,
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
  oauth: 'OAuth 网关',
  custom: '自定义'
}

export function getOmpPresetById(id) {
  return ompPresets.find(preset => preset.id === id)
}

export function getOmpPresetsByCategory(category) {
  return ompPresets.filter(preset => preset.category === category)
}
