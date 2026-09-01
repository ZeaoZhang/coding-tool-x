import { defineStore, createPinia, getActivePinia } from 'pinia'
import { getCurrentInstance } from 'vue'
import { getPlatforms } from '../api/platforms'
import { DEFAULT_ENABLED_CLI_PLATFORMS, MINIMAL_PLATFORM_FALLBACK, normalizePublicPlatforms } from '../config/platforms'
import { resolveEnabledCliPlatforms } from '../config/platformCatalog'
import { useUIConfig } from '../composables/useUIConfig'
const FALLBACK_PLATFORM_KEYS = new Set(DEFAULT_ENABLED_CLI_PLATFORMS)
const FALLBACK_PLATFORMS = MINIMAL_PLATFORM_FALLBACK.filter(platform => FALLBACK_PLATFORM_KEYS.has(platform.key))

const definePlatformStore = defineStore('platforms', {
  state: () => ({
    platforms: normalizePublicPlatforms(FALLBACK_PLATFORMS),
    loaded: false,
    loading: false,
    error: null,
    loadPromise: null
  }),
  getters: {
    all: state => state.platforms,
    enabled: state => {
      const { uiConfig } = useUIConfig()
      const selectedKeys = resolveEnabledCliPlatforms({
        catalog: state.platforms,
        enabledCliPlatforms: uiConfig.value.enabledCliPlatforms
      })
      const byKey = new Map(state.platforms.map(platform => [platform.key, platform]))
      return selectedKeys.map(key => byKey.get(key)).filter(Boolean)
    }
  },
  actions: {
    async fetchPlatforms() {
      return getPlatforms()
    },

    async load({ force = false } = {}) {
      if (!force && this.loaded) return this.platforms
      if (this.loadPromise) return this.loadPromise

      this.loading = true
      this.error = null
      this.loadPromise = this.fetchPlatforms()
        .then((result) => {
          const normalized = normalizePublicPlatforms(result)
          if (normalized.length > 0) this.platforms = normalized
          this.loaded = true
          return this.platforms
        })
        .catch((cause) => {
          this.error = cause
          this.loaded = true
          return this.platforms
        })
        .finally(() => {
          this.loading = false
          this.loadPromise = null
        })
      return this.loadPromise
    },

    get(key) {
      const normalized = String(key || '').trim().toLowerCase()
      return this.platforms.find(platform => platform.key === normalized) || null
    },

    hasCapability(key, capability) {
      const platform = this.get(key)
      return platform?.capabilities?.[capability] === true
        || platform?.resourceTypes?.[capability] === true
    }
  }
})

let fallbackPinia = null

function findProvidedPinia() {
  const instance = getCurrentInstance()
  if (!instance) return getActivePinia()
  const provides = instance.appContext?.provides || {}
  for (const symbol of Object.getOwnPropertySymbols(provides)) {
    const value = provides[symbol]
    if (value && value._s && typeof value.install === 'function') return value
  }
  return null
}

export function usePlatformStore(pinia) {
  const activePinia = pinia || findProvidedPinia() || (fallbackPinia ||= createPinia())
  return definePlatformStore(activePinia)
}

usePlatformStore.$id = definePlatformStore.$id
