import { defineStore, createPinia, getActivePinia } from 'pinia'
import { getCurrentInstance } from 'vue'
import { getPlatforms } from '../api/platforms'
import { MINIMAL_PLATFORM_FALLBACK, normalizePublicPlatforms } from '../config/platforms'

const definePlatformStore = defineStore('platforms', {
  state: () => ({
    platforms: normalizePublicPlatforms(MINIMAL_PLATFORM_FALLBACK),
    loaded: false,
    loading: false,
    error: null,
    loadPromise: null
  }),
  getters: {
    all: state => state.platforms,
    enabled: state => state.platforms.filter(platform => platform.enabled !== false && platform.defaultVisible !== false)
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
      return this.get(key)?.capabilities?.[capability] === true
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
