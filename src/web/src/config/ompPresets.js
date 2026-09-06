import { opencodePresets } from './opencodePresets'

export const ompPresets = [
  ...opencodePresets
]

export const ompPresetCategories = {
  apikey: 'API Key',
  entry: '转换入口',
  custom: '自定义'
}

export function getOmpPresetById(id) {
  return ompPresets.find(preset => preset.id === id)
}

export function getOmpPresetsByCategory(category) {
  return ompPresets.filter(preset => preset.category === category)
}

