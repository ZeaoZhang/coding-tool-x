import { storeToRefs } from 'pinia'
import { useFavoritesStore } from '../stores/favorites'

export function useFavorites() {
  const store = useFavoritesStore()
  const { favorites, totalFavorites } = storeToRefs(store)

  if (!store.isLoaded) {
    store.loadFavorites().catch(() => {})
  }

  function getFavorites(channel) {
    return store.getFavoritesByChannel(channel)
  }

  function getAllFavorites() {
    return favorites.value
  }

  return {
    favorites,
    addFavorite: store.addFavorite,
    removeFavorite: store.removeFavorite,
    isFavorite: store.isFavorite,
    getFavorites,
    getAllFavorites,
    totalFavorites,
    loadFavorites: store.loadFavorites
  }
}
