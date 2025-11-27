import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getAllFavorites, addFavorite as addFavoriteApi, removeFavorite as removeFavoriteApi } from '../api/favorites'

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref({
    claude: [],
    codex: [],
    gemini: []
  })

  const isLoaded = ref(false)
  const loading = ref(false)

  async function loadFavorites(force = false) {
    if (isLoaded.value && !force) {
      return favorites.value
    }
    loading.value = true
    try {
      const response = await getAllFavorites()
      if (response.success && response.favorites) {
        favorites.value = {
          claude: response.favorites.claude || [],
          codex: response.favorites.codex || [],
          gemini: response.favorites.gemini || []
        }
      }
      isLoaded.value = true
      return favorites.value
    } catch (err) {
      console.error('Failed to load favorites:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function addFavorite(channel, sessionData) {
    try {
      const response = await addFavoriteApi(channel, sessionData)
      if (response.success && response.favorites) {
        favorites.value = response.favorites
        return true
      }
    } catch (err) {
      console.error('Failed to add favorite:', err)
    }
    return false
  }

  async function removeFavorite(channel, projectName, sessionId) {
    try {
      const response = await removeFavoriteApi(channel, projectName, sessionId)
      if (response.success && response.favorites) {
        favorites.value = response.favorites
        return true
      }
    } catch (err) {
      console.error('Failed to remove favorite:', err)
    }
    return false
  }

  function isFavorite(channel, projectName, sessionId) {
    if (!favorites.value[channel]) return false
    return favorites.value[channel].some(
      fav => fav.sessionId === sessionId && fav.projectName === projectName
    )
  }

  function getFavoritesByChannel(channel) {
    return favorites.value[channel] || []
  }

  const totalFavorites = computed(() => {
    return (favorites.value.claude?.length || 0) +
      (favorites.value.codex?.length || 0) +
      (favorites.value.gemini?.length || 0)
  })

  return {
    favorites,
    totalFavorites,
    isLoaded,
    loading,
    loadFavorites,
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavoritesByChannel
  }
})
