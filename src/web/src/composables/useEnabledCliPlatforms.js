import { computed } from 'vue'
import { usePlatformStore } from '../stores/platforms'
import { useUIConfig } from './useUIConfig'
import { resolveEnabledCliPlatforms } from '../config/platformCatalog'

export function useEnabledCliPlatforms({ platformStore, configRef } = {}) {
  const store = platformStore || usePlatformStore()
  const { uiConfig } = useUIConfig()
  const selectedConfig = configRef || uiConfig
  const catalog = computed(() => store.all || store.platforms || [])
  const enabledKeys = computed(() => resolveEnabledCliPlatforms({
    catalog: catalog.value,
    enabledCliPlatforms: selectedConfig.value?.enabledCliPlatforms
  }))
  const byKey = computed(() => new Map(
    catalog.value.map(platform => [platform.key, platform])
  ))
  const enabledPlatforms = computed(() => enabledKeys.value
    .map(key => byKey.value.get(key))
    .filter(Boolean))

  function getPlatform(key) {
    const normalized = String(key || '').trim().toLowerCase()
    return byKey.value.get(normalized) || null
  }

  function byCapability(capability) {
    return enabledPlatforms.value.filter(platform => (
      platform.capabilities?.[capability] === true
      || platform.resourceTypes?.[capability] === true
    ))
  }

  return {
    catalog,
    enabledPlatforms,
    enabledKeys,
    byCapability,
    getPlatform
  }
}
